-- WebAuthn/Passkey credentials for passwordless authentication
-- Separate from password_hash in users table - a user can have both
-- KEY-DECISION 2026-02-20: stored as separate table (not column on users) so one user
-- can register multiple passkeys (phone, laptop, hardware key) independently.

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,                          -- base64url-encoded credential ID from authenticator
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,                      -- base64url-encoded COSE public key
  counter INTEGER NOT NULL DEFAULT 0,            -- replay protection: must increase on each auth
  transports TEXT,                               -- comma-separated: usb,nfc,ble,internal,hybrid
  device_type TEXT,                              -- singleDevice | multiDevice
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);
