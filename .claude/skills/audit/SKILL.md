---
name: audit
description: On-demand code quality audit replacing ESLint. Checks types, React hooks correctness, code hygiene, architecture drift, and tech debt signals. Invoke with /audit or /audit <path> for targeted scope.
argument-hint: "[path]"
disable-model-invocation: true
allowed-tools: Bash, Grep, Glob, Read
---

# Code Quality Audit

Run a structured quality audit on this codebase (or the path specified in `$ARGUMENTS` if provided).

**Scope:** If `$ARGUMENTS` is provided, restrict grep searches to that path. Otherwise audit all of `src/`.

Work through each section below in order. Collect all findings, then output the final report.

---

## 1. Type Safety

### 1a. Bare `any` without rationale
Search for TypeScript `any` usage that lacks a rationale comment on the same line or the immediately preceding line.

```bash
grep -rn ": any\|as any\|<any>" src/ --include="*.ts" --include="*.tsx"
```

Flag any hit where neither that line nor the line above contains a comment explaining why `any` is acceptable (e.g., `// any: ...`, `// eslint-disable`, or a descriptive rationale).

Count total `as any` casts separately for the Stats section.

### 1b. TypeScript type errors
Run the project's typecheck command:

```bash
npm run typecheck 2>&1
```

Report all errors. Zero errors = pass. Any errors = Critical.

---

## 2. React Hooks

### 2a. Rules of Hooks violations
Search for hooks called conditionally or inside loops. Look for patterns like:

```bash
grep -rn "if.*use[A-Z]\|use[A-Z].*&&\|use[A-Z].*?\." src/client/ --include="*.tsx" --include="*.ts"
```

Also check for hooks inside `.map(`, `.forEach(`, `.filter(` callbacks:

```bash
grep -rn "\.map.*use[A-Z]\|\.forEach.*use[A-Z]" src/client/ --include="*.tsx" --include="*.ts"
```

Flag any genuine violations (hooks conditionally called based on runtime values).

### 2b. Exhaustive deps signals
Look for comments indicating intentional exhaustive-deps skips (these are known-intentional and should be noted as Info, not errors):

```bash
grep -rn "eslint-disable.*exhaustive-deps\|exhaustive-deps" src/ --include="*.ts" --include="*.tsx"
```

Flag these as Info - they were previously suppressed and should be reviewed to confirm the skip is still intentional.

---

## 3. Code Hygiene

### 3a. console.log usage (console.warn/error/debug are fine)
```bash
grep -rn "console\.log(" src/ --include="*.ts" --include="*.tsx"
```

Any hit in non-test files = Warning.

### 3b. TODO / FIXME / HACK comments
```bash
grep -rn "TODO\|FIXME\|HACK" src/ --include="*.ts" --include="*.tsx"
```

List each one. Suggest adding to the task list if the comment has been there long enough to drift (no date context = likely stale).

### 3c. Files over 500 lines
Check all TypeScript/TSX files for line count:

```bash
find src/ -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -20
```

Flag any file (excluding the total line) over 500 lines as a Warning - consider splitting.

---

## 4. Architecture Drift

### 4a. Server file table accuracy
The CLAUDE.md "Key server files" table lists these files. Verify each exists:
- `src/server/index.ts`
- `src/server/chat-agent.ts`
- `src/server/ai-tools-sdk.ts`
- `src/server/prompts.ts`
- `src/server/tracing-middleware.ts`
- `src/server/auth.ts`
- `src/shared/types.ts`
- `src/shared/board-templates.ts`

Also list any `.ts` files in `src/server/` that are NOT in the table:

```bash
ls src/server/*.ts
```

Flag unlisted server files as Info (CLAUDE.md may need updating).

### 4b. Client component table accuracy
The CLAUDE.md "Key client files" table lists these components. Verify each exists:
- `src/client/components/Board.tsx`
- `src/client/components/ChatPanel.tsx`
- `src/client/components/OnboardModal.tsx`
- `src/client/components/AuthForm.tsx`

Also list any `.tsx` files in `src/client/components/` not mentioned in CLAUDE.md's monorepo layout section:

```bash
ls src/client/components/*.tsx
```

Flag unlisted components as Info.

### 4c. fetch() missing credentials
Client-side `fetch()` calls must include `credentials: "include"` to send the session cookie. Search for fetch calls that lack it:

```bash
grep -rn "fetch(" src/client/ --include="*.ts" --include="*.tsx" -A 3
```

For each `fetch(` hit, check if `credentials: "include"` appears within 5 lines. Flag any that don't as Critical (auth will silently fail).

---

## 5. Tech Debt Signals

### 5a. Functions over 100 lines
Read the largest files identified in 3c. For each, do a rough scan for function definitions and estimate whether any function body exceeds 100 lines. Flag candidates as Warning.

### 5b. Duplicate string literals
Search for string literals repeated 3+ times that could be constants:

```bash
grep -rh "\"[a-zA-Z][a-zA-Z_/:-]{8,}\"" src/ --include="*.ts" --include="*.tsx" | sort | uniq -c | sort -rn | head -20
```

Flag any string appearing 4+ times that looks like a candidate for a shared constant.

---

## Output Format

After completing all checks, output the following report (and nothing else after it):

```
## Audit Report

### Critical (fix now)
- [list each issue with file:line reference]
- (none) if clean

### Warnings (fix soon)
- [list each issue with file:line reference]
- (none) if clean

### Info (tech debt drift)
- [list each issue - unlisted files, intentional skips, stale TODOs]
- (none) if clean

### Stats
- TypeScript errors: N
- `any` without rationale: N
- `as any` casts (total): N
- console.log occurrences: N
- TODO/FIXME/HACK count: N
- Files >500 lines: N (list filenames)
- Intentional exhaustive-deps skips: N
```

---

## Workflow Suggestion

If you find 3 or more Critical issues, include this note at the end of the report:

> **Recurring audit recommended.** With N critical issues found, consider adding `/audit` to your regular workflow - e.g., run it before each push or weekly as a hygiene check. It takes under 2 minutes and catches drift before it compounds.
