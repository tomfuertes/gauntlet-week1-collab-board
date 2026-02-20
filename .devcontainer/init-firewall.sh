#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

# 1. Extract Docker DNS info BEFORE any flushing
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

# Flush existing rules and delete existing ipsets
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

# 2. Selectively restore ONLY internal Docker DNS resolution
if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    while IFS= read -r rule; do
        [[ "$rule" =~ ^-[A-Z] ]] || continue
        # shellcheck disable=SC2086 - intentional word-split of iptables args
        iptables -t nat $rule 2>/dev/null || true
    done <<< "$DOCKER_DNS_RULES"
else
    echo "No Docker DNS rules to restore"
fi

# Allow DNS (UDP + TCP for large responses), SSH, and localhost before any restrictions
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
iptables -A INPUT -p tcp --sport 53 -m state --state ESTABLISHED -j ACCEPT
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Create ipset with CIDR support
ipset create allowed-domains hash:net

# Fetch GitHub meta information and aggregate + add their IP ranges
echo "Fetching GitHub IP ranges..."
gh_ranges=$(curl -sS --fail --connect-timeout 10 https://api.github.com/meta 2>&1) || {
    echo "ERROR: Failed to fetch GitHub IP ranges: $gh_ranges" >&2
    exit 1
}

if ! echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null; then
    echo "ERROR: GitHub API response missing required fields" >&2
    exit 1
fi

echo "Processing GitHub IPs..."
gh_cidrs=$(echo "$gh_ranges" | jq -r '(.web + .api + .git)[]' | aggregate -q) || {
    echo "ERROR: Failed to process GitHub IP ranges" >&2
    exit 1
}
if [ -z "$gh_cidrs" ]; then
    echo "ERROR: GitHub IP range processing produced no output" >&2
    exit 1
fi
while read -r cidr; do
    if [[ ! "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        echo "ERROR: Invalid CIDR range from GitHub meta: $cidr" >&2
        exit 1
    fi
    echo "Adding GitHub range $cidr"
    ipset add allowed-domains "$cidr" -exist
done <<< "$gh_cidrs"

# Domains Claude Code and its tooling need at runtime
for domain in \
    "registry.npmjs.org" \
    "npmjs.com" \
    "nodejs.org" \
    "api.anthropic.com" \
    "docs.anthropic.com" \
    "code.claude.com" \
    "sentry.io" \
    "statsig.anthropic.com" \
    "statsig.com" \
    "developer.mozilla.org" \
    "developers.cloudflare.com" \
    "api.cloudflare.com" \
    "dash.cloudflare.com" \
    "workers.cloudflare.com" \
    "json.schemastore.org" \
    "openai.com" \
    "platform.openai.com" \
    "marketplace.visualstudio.com" \
    "vscode.blob.core.windows.net" \
    "update.code.visualstudio.com"; do
    echo "Resolving $domain..."
    ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
    if [ -z "$ips" ]; then
        echo "ERROR: Failed to resolve $domain" >&2
        exit 1
    fi

    while read -r ip; do
        if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "ERROR: Invalid IP from DNS for $domain: $ip" >&2
            exit 1
        fi
        echo "Adding $ip for $domain"
        ipset add allowed-domains "$ip" -exist
    done < <(echo "$ips")
done

# Get host IP from default route
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
    echo "ERROR: Failed to detect host IP" >&2
    exit 1
fi

HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
echo "Host network detected as: $HOST_NETWORK"

# Allow host network access before locking down with DROP default policies
iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

# Restore permissive policies on failure to prevent container lockout
cleanup_on_error() {
    echo "ERROR: Firewall setup failed - restoring permissive policies" >&2
    iptables -P INPUT ACCEPT
    iptables -P FORWARD ACCEPT
    iptables -P OUTPUT ACCEPT
}
trap cleanup_on_error ERR

# Lock down defaults - must come after specific ACCEPT rules above
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Allow response packets for outbound connections matched by allowed-domains
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow outbound to ipset-allowed destinations
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# REJECT all other outbound for immediate feedback (not silent DROP)
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

trap - ERR

echo "Firewall configuration complete"
echo "Verifying firewall rules..."
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - was able to reach https://example.com" >&2
    exit 1
else
    echo "Firewall verification passed - unable to reach https://example.com as expected"
fi

if ! curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - unable to reach https://api.github.com" >&2
    exit 1
else
    echo "Firewall verification passed - able to reach https://api.github.com as expected"
fi
