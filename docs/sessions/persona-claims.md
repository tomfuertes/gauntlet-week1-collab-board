# Session: persona-claims

Date: 2026-02-20

## What Shipped

Per-player AI persona claims across 4 files, 0 new D1 tables, 0 new files.

### Server (`chat-agent.ts`)
- Added `_personaClaims = new Map<string, string>()` class field (username -> Persona.id) with KEY-DECISION comment explaining the ephemeral pattern (same as body.model/body.gameMode)
- Added `_resolveActivePersona(personas, username)` helper: checks claim map, falls back to round-robin if no claim or persona deleted
- Wired `body.personaId` + `body.username` into `onChatMessage` to update claims map and call the new resolver instead of inline index math
- Left `_triggerReactivePersona` and `onDirectorNudge` untouched (they don't have player context - correct behavior)

### Client (`OnboardModal.tsx`)
- Extended `onSubmit` signature to `(prompt, gameMode, aiModel, personaId)` - 4 args
- Added `personas?: Persona[]` prop (defaults to DEFAULT_PERSONAS)
- Added `selectedModel` state (default "gpt-4o-mini") and `selectedPersonaId` state (default null)
- Added character picker pill row: "Anyone" (null) + one pill per persona with colored border
- Added compact model selector `<select>` matching header style
- Updated all submit paths (submit(), template chips, hat button) to pass all 4 args

### Board (`Board.tsx`)
- Added `claimedPersonaId: string | null` state (default null)
- Updated OnboardModal callback to destructure 4 args: `(prompt, mode, model, personaId)` -> sets all 4 state values
- Passed `claimedPersonaId` + `onClaimChange={setClaimedPersonaId}` to both ChatPanel instances (mobile + desktop)
- Kept header model selector as power-user override (mid-scene changes)

### ChatPanel (`ChatPanel.tsx`)
- Added `claimedPersonaId?: string | null` and `onClaimChange?: (personaId: string | null) => void` props
- Added `personaId: claimedPersonaId ?? undefined` to `useAgentChat` body
- Added inline persona claim pill row in header (below persona names, above messages): shows only when `onClaimChange` provided AND 2+ personas loaded - this is how Player B claims without going through OnboardModal

## Key Decisions

- **Ephemeral claim pattern**: Claims reset on DO hibernation; client re-sends `body.personaId` on every message. Same pattern as `body.model` and `body.gameMode`. No D1 writes needed.
- **OnboardModal uses DEFAULT_PERSONAS**: Board doesn't fetch custom personas for the modal (rare at scene-start; owners manage via ChatPanel gear). Avoids adding a fetch to Board.tsx.
- **Round-robin preserved**: If claim not found (persona deleted), falls back to `_activePersonaIndex % N`. Backward compatible for solo/no-claim usage.
- **Reactive persona unchanged**: `_triggerReactivePersona` uses `(activeIndex + 1) % N` - already correct, reacts to whoever the active persona was.
- **Director unchanged**: Uses round-robin (no player context for director nudges - correct).

## Verification Status

- `npx tsc --noEmit`: passed clean
- `npm run lint`: passed clean
- UAT: pending (dev server start was denied by user permission gate)

## Loose Ends Found

- None - the implementation matches the spec exactly
