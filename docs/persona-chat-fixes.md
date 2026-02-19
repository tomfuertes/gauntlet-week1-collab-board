# Fix: Persona Chat Display + Reactive Behavior

## Context

Three bugs making the multi-agent improv feel broken:
1. Empty bubble labeled "AI" appears before SPARK speaks (tool-only step has no text, label falls back to "AI")
2. `[SPARK]` appears literally mid-text in the chat bubble (ensurePersonaPrefix patches ALL text parts, second occurrence shows raw)
3. SAGE reactive response is always the fallback "*reacts to the scene*" and dumps objects without speaking

## Bug 1: Empty "AI" bubble

**Root cause:** `ChatPanel.tsx:557` sets `senderLabel = msg.role === "assistant" ? (sender ?? "AI") : sender`. Any assistant message - even one with only tool parts and no text - renders a labeled bubble. When streamText produces a tool-only step (LLM calls tools, no text preamble), it becomes a message with no text parts, no recognized prefix, `sender = undefined`, `senderLabel = "AI"`, `content = ""`.

**Fix:** In ChatPanel render loop, skip the entire message div if content is empty AND tools is empty:
```typescript
if (msg.role === "assistant" && !content && tools.length === 0) return null;
```
File: `src/client/components/ChatPanel.tsx` (~line 559, add before `return (`)

## Bug 2: `[SPARK]` in bubble text

**Root cause:** `_ensurePersonaPrefix` (chat-agent.ts:523-544) checks `needsFix = parts.some(p => !p.text.startsWith(prefix))` - true if ANY text part is missing it. Then patches ALL text parts. Multi-step streamText produces 2 text parts when LLM speaks before AND after tool calls: part 1 already has `[SPARK]`, part 2 ("Done!") gets `[SPARK]` added. ChatPanel concatenates all text parts, SENDER_RE strips only the first, leaving `[SPARK]` raw mid-text.

**Fix:** Only check and patch the FIRST text part:
```typescript
// needsFix: only if the first text part is missing the prefix
const firstTextPart = lastMsg.parts.find((p) => p.type === "text");
const needsFix = !!firstTextPart && !firstTextPart.text.startsWith(`[${personaName}]`);

// patch: only prefix the first text part
let patched = false;
const newParts = lastMsg.parts.map((part) => {
  if (!patched && part.type === "text" && !part.text.startsWith(`[${personaName}]`)) {
    patched = true;
    return { ...part, text: `[${personaName}] ${part.text}` };
  }
  return part;
});
```
File: `src/server/chat-agent.ts` (~lines 523-538)

## Bug 3: Reactive persona silent + object dump

**Root cause:**
- `generateText` result has no `text` (LLM only calls tools), so `result.text = ""` -> fallback `"[SAGE] *reacts to the scene*"` is used
- `stopWhen: stepCountIs(3)` allows 3 tool-calling rounds -> dumps many objects
- Reactive prompt says "1-2 canvas actions max" but that's a soft suggestion the LLM ignores when it has batchExecute available

**Fix (option 2 - inject context):**
1. Reduce `stopWhen: stepCountIs(3)` → `stepCountIs(2)` (1 tool round + 1 text round max)
2. Before calling `generateText`, extract what the active persona just created from `this.messages[this.messages.length - 1].parts` - filter to `tool-*` and `dynamic-tool` parts, pull `toolName` + key input fields (text, fill, x, y) - format as a brief "SPARK just placed:" context block
3. Inject that context + strengthened prompt:
```
[REACTIVE MODE] ${activePersona.name} just placed: <extracted objects summary>
React in character with exactly 1 spoken sentence (required - always produce text).
Optionally place 1 canvas object that BUILDS on theirs (same area, related content) - do NOT use batchExecute.
```
4. Change fallback text to `"..."` so it doesn't look broken if hit

**Context extraction helper** (new private method `_describeLastAction`):
- reads last assistant message parts
- maps `tool-*` parts: `toolName.replace("tool-","") + ": " + (input.text || input.fill || "")`
- returns 1-line summary string, empty string if no tool parts

File: `src/server/chat-agent.ts` (~lines 675-700, +new helper)

## Bug 4: Agents dump cards; setup scene is under-populated

**User intent:** First message should produce a rich establishing scene. Agents should compose multi-tool characters (sticky for trait + colored rect for icon + sticky for hidden flaw) rather than 10 identical yellow stickies.

**Fix:** Two additions to `SYSTEM_PROMPT` in `prompts.ts`:

1. **Replace** vague SCENE SETUP section (~line 196) with explicit structure:
```
SCENE SETUP: On the FIRST exchange, establish the world with batchExecute:
- 1 location frame (title = where we are)
- 2-3 character stickies INSIDE the frame (name + defining trait, 5-8 words)
- 1-2 prop stickies (specific, funny details players can riff on)
On subsequent exchanges: 2-3 targeted actions MAX. Build on what exists, don't restart.
```

2. **Add** CHARACTER COMPOSITION section after LAYOUT RULES:
```
CHARACTER COMPOSITION: Build characters with 2-3 tools together - not 10 separate stickies:
- Primary sticky: name + defining trait ("BRENDA: true believer, weeps at motivational posters")
- Color-coded rect/circle beside it as their visual marker (same x, offset y)
- Optional 2nd sticky: hidden flaw or secret ("secretly hates the product")
Same for locations: 1 labeled frame + 2-3 prop stickies inside > 8 stickies scattered randomly.
Quality over quantity - 3 composed objects beat 10 identical cards.
```

File: `src/server/prompts.ts` (SYSTEM_PROMPT, SCENE SETUP ~line 196 + new section after LAYOUT RULES)

## Files

- `src/server/chat-agent.ts` - Bugs 2 + 3
- `src/client/components/ChatPanel.tsx` - Bug 1
- `src/server/prompts.ts` - Bug 4

## Verification

1. `npm run dev`
2. Open board, send "a guy in a cult bootcamp for ai development"
3. Expect: rich establishing scene (frame + character stickies + props), no preceding empty "AI" bubble, SPARK labeled correctly, SAGE says 1 witty line + optionally 1 complementary object
4. Send "Plot twist!" - SAGE reacts with knowledge of what SPARK placed
5. Verify no `[SPARK]` or `[SAGE]` text inside bubble content
