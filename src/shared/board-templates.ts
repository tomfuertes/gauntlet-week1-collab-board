/** Board generation templates - single source of truth for overlay chips + chat panel */

export interface BoardTemplate {
  label: string;
  icon: string;
  prompt: string;
}

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    label: "SWOT Analysis",
    icon: "+",
    prompt: `Create a SWOT analysis with this exact layout:
createFrame "Strengths" x=50 y=80 width=440 height=280
createFrame "Weaknesses" x=520 y=80 width=440 height=280
createFrame "Opportunities" x=50 y=390 width=440 height=280
createFrame "Threats" x=520 y=390 width=440 height=280
Then add 2 stickies inside each frame:
Strengths: x=60,y=120 and x=260,y=120 (green #4ade80)
Weaknesses: x=530,y=120 and x=730,y=120 (red #f87171)
Opportunities: x=60,y=430 and x=260,y=430 (blue #60a5fa)
Threats: x=530,y=430 and x=730,y=430 (orange #fb923c)
Write brief example content on each sticky.`,
  },
  {
    label: "Sprint Retro",
    icon: "\u21BB",
    prompt: `Create a sprint retrospective with this exact layout:
createFrame "What Went Well" x=50 y=80 width=320 height=480
createFrame "What Didn't Go Well" x=400 y=80 width=320 height=480
createFrame "Action Items" x=750 y=80 width=320 height=480
Add 2 stickies per frame:
Went Well: x=60,y=120 and x=60,y=330 (green #4ade80)
Didn't Go Well: x=410,y=120 and x=410,y=330 (red #f87171)
Action Items: x=760,y=120 and x=760,y=330 (blue #60a5fa)
Write brief example content on each sticky.`,
  },
  {
    label: "Project Plan",
    icon: "\u25B6",
    prompt: `Create a project plan with this exact layout:
createFrame "Phase 1: Research" x=50 y=80 width=280 height=400
createFrame "Phase 2: Build" x=360 y=80 width=280 height=400
createFrame "Phase 3: Launch" x=670 y=80 width=280 height=400
Add 3 stickies in Phase 1: x=60,y=120 x=60,y=280 x=60,y=430 (blue #60a5fa)
Add 3 stickies in Phase 2: x=370,y=120 x=370,y=280 x=370,y=430 (purple #c084fc)
Add 2 stickies in Phase 3: x=680,y=120 x=680,y=280 (green #4ade80)
Write brief example content on each sticky.`,
  },
  {
    label: "Brainstorm",
    icon: "\u2728",
    prompt: `Create a brainstorm layout:
createStickyNote "Main Topic" x=450 y=350 color=#c084fc
Then create 8 idea stickies in a circle around it:
x=450,y=100 x=700,y=180 x=780,y=350 x=700,y=520
x=450,y=600 x=200,y=520 x=120,y=350 x=200,y=180
Alternate colors: #fbbf24, #60a5fa, #4ade80, #f87171.
Write a creative brainstorm idea on each sticky.`,
  },
  {
    label: "Kanban",
    icon: "\u2630",
    prompt: `Create a Kanban board with this exact layout:
createFrame "To Do" x=50 y=80 width=320 height=680
createFrame "In Progress" x=400 y=80 width=320 height=680
createFrame "Done" x=750 y=80 width=320 height=680
Add 3 example task stickies in the To Do column:
x=60 y=120, x=60 y=340, x=60 y=550
Use yellow #fbbf24 stickies with brief task descriptions.`,
  },
];
