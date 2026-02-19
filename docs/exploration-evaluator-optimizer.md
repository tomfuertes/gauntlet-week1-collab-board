# Evaluator-Optimizer (CF Agent Pattern)

*Exploration notes - not a deliverable. See [CF agent patterns](https://developers.cloudflare.com/agents/patterns/).*

## What it is

Generator LLM produces output. Evaluator LLM critiques it. Loop until quality threshold is met. Two models (or two calls to the same model) in a generate-evaluate-regenerate cycle.

```
Generator: "Here's a scene setup with 3 stickies"
Evaluator: "Score 4/10 - stickies overlap, text is too long, no frame"
Generator: "Here's a revised setup with frame + shorter text + spacing"
Evaluator: "Score 8/10 - good layout, punchy text, clear scene"
-> Done, serve to user
```

## What we do instead

Single-pass generation. The AI creates objects via tools in one `streamText` call (up to 5 steps). No quality check. If stickies overlap or text is boring, it ships anyway.

We DO have an overlap score metric (`computeOverlapScore` in `ai-tools-sdk.ts`) that logs overlap for observability, but the AI never sees or acts on it.

## Where it would help

### Scene setup quality
When a user says "set the scene at a dentist office," the AI creates a frame + stickies. Sometimes:
- Stickies overlap or land outside the frame
- Text is generic ("A chair") instead of punchy ("Chair that reclines too far back")
- Layout is cluttered (everything in one corner)

An evaluator pass could check:
```typescript
const evalResult = await generateText({
  model: this._getModel(),
  system: "Rate this scene setup 1-10. Check: overlap score, text quality, spatial layout, creative specificity.",
  messages: [{ role: "user", content: JSON.stringify(boardState) }],
});
// If score < 7, regenerate with feedback
```

### Hat prompt responses
In Scenes From a Hat, responses should be quick and punchy. An evaluator could check "is this response on-prompt?" and "is it under 15 words?" before serving.

## Where it would hurt

- **Latency**: Every generation now takes 2x (generate + evaluate). Our current ~7s response becomes ~14s.
- **Cost**: Double the LLM calls, double the tokens.
- **Improv pacing**: Speed matters. A 7-second response feels snappy. 14 seconds feels like the AI is overthinking.
- **Diminishing returns**: Most responses are fine. The evaluator would approve 80% on first pass, making those 80% take twice as long for no benefit.

## Possible middle ground

Only evaluate on scene SETUP (the first response), not on subsequent exchanges:
```typescript
if (humanTurns === 1 && this._gameMode !== "hat") {
  // First message = scene setup. Worth evaluating.
  const setup = await generateText({ ... });
  const eval = await generateText({ system: EVAL_PROMPT, ... });
  if (eval.score < 7) {
    // Regenerate with feedback
    await generateText({ system: SYSTEM_PROMPT + eval.feedback, ... });
  }
}
```

This targets the highest-impact moment (first impression of the scene) without slowing down the back-and-forth improv.

## Decision

Interesting for scene setup quality. Not worth the latency/cost trade-off for conversational exchanges. Could pair well with Code Mode (evaluate the generated code before executing it).
