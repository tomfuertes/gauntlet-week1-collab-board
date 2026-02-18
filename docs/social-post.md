# Social Post - CollabBoard

## Short Version (Twitter/X)

Built a multiplayer improv canvas in a week.

You set the scene. AI builds the stage. Your friends add the chaos.

"A dentist who's a vampire" -> AI places Dr. Fang, a nervous patient, and a face-down mirror on the canvas. Your friend adds "the patient brought a gift." AI creates a gift box labeled "mirror" - Dr. Fang eyes it nervously.

Three participants, one canvas, zero control over where the scene goes.

Stack: React + Cloudflare Workers + Durable Objects + Vercel AI SDK. Real-time WebSocket sync, AI as a visible scene partner (you can see its cursor placing props).

The humor comes from the collision of human ideas and AI escalation. The canvas makes it persistent and spatial - proximity means relationship, distance means tension.

https://collabboard.thomas-fuertes.workers.dev

## Thread Version

**1/5** Built a multiplayer improv canvas this week for Gauntlet AI. Think: collaborative comedy on a shared whiteboard, with AI as your scene partner.

**2/5** How it works: type "A dentist who's a vampire" and AI sets the scene - frame, characters, props all placed on a spatial canvas. Your friend types "the patient brought a gift" and AI escalates: a gift box labeled "mirror." The board accumulates the entire improv.

**3/5** What makes it different from group chat + AI: it's spatial. Position encodes meaning. Moving the garlic mouthwash closer to Dr. Fang IS the joke. Text can't do that.

**4/5** Tech: React + Cloudflare Workers + Durable Objects for real-time sync. AI uses Vercel AI SDK with 10 tools (create/move/resize stickies, frames, connectors). Chat persists server-side in DO SQLite. All clients see the same scene unfold via WebSocket.

**5/5** The whole thing runs on CF's free tier (Workers AI for LLM, Durable Objects for state, D1 for auth). Upgrade to Claude Haiku 4.5 for ~$0.004/interaction. Try it: https://collabboard.thomas-fuertes.workers.dev

## Key Points to Hit
- Multiplayer + AI + spatial canvas = nobody else has this combo
- AI is a visible performer, not a chatbot in a box (cursor moves, places props)
- Built in 1 week (Gauntlet AI Week 1)
- Runs on Cloudflare free tier
- "Yes, and" - AI never says no, always escalates
