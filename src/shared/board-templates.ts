/** Scene starter templates - single source of truth for overlay chips + chat panel */

export interface BoardTemplate {
  label: string;
  icon: string;
  prompt: string;
}

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    label: "Vampire Dentist",
    icon: "\u{1F9DB}",
    prompt: `Set the scene: A dentist's office, but the dentist is a vampire.
createFrame "Dr. Fang's Dental Clinic" x=50 y=80 width=900 height=600
Create character stickies inside the frame:
createStickyNote "Dr. Fang - nervously avoids mirrors, flinches at garlic mouthwash" x=60 y=120 color=#c084fc
createStickyNote "Patient - suspiciously enthusiastic about the lack of windows" x=280 y=120 color=#fbbf24
createStickyNote "Dental chair - reclines to a coffin-like angle" x=500 y=120 color=#60a5fa
Create prop stickies:
createStickyNote "A sign: 'No Garlic Gum Allowed'" x=60 y=350 color=#f87171
createStickyNote "Unusually opaque sunglasses on the counter" x=280 y=350 color=#fb923c
createStickyNote "A mirror - face down" x=500 y=350 color=#4ade80
Write short punchy text. Scene set - go!`,
  },
  {
    label: "Moon Job Interview",
    icon: "\u{1F311}",
    prompt: `Set the scene: A job interview taking place on the moon.
createFrame "Lunar Corp - Interview Room 7" x=50 y=80 width=900 height=600
Create character stickies inside the frame:
createStickyNote "Interviewer - keeps floating out of their chair mid-question" x=60 y=120 color=#60a5fa
createStickyNote "Candidate - brought a physical resume that won't stay on the table" x=280 y=120 color=#fbbf24
createStickyNote "HR person - communicating via 4-second radio delay from Earth" x=500 y=120 color=#c084fc
Create prop stickies:
createStickyNote "A whiteboard that drifts away when you write on it" x=60 y=350 color=#f87171
createStickyNote "Coffee in a squeeze pouch labeled 'Executive Blend'" x=280 y=350 color=#fb923c
createStickyNote "Window with Earth view - very distracting" x=500 y=350 color=#4ade80
Write short punchy text. Scene set - go!`,
  },
  {
    label: "Cat Restaurant",
    icon: "\u{1F408}",
    prompt: `Set the scene: Two cats opening a restaurant.
createFrame "Whiskers & Mittens' Bistro - Grand Opening" x=50 y=80 width=900 height=600
Create character stickies inside the frame:
createStickyNote "Chef Whiskers - insists everything is better with tuna" x=60 y=120 color=#fb923c
createStickyNote "Mittens (front of house) - pushes things off tables 'for ambiance'" x=280 y=120 color=#c084fc
createStickyNote "First customer - a very confused dog" x=500 y=120 color=#fbbf24
Create prop stickies:
createStickyNote "Menu: everything is fish. The 'vegetarian option' is also fish." x=60 y=350 color=#f87171
createStickyNote "A cardboard box labeled 'VIP Seating'" x=280 y=350 color=#4ade80
createStickyNote "Health inspector (a parrot) arrives" x=500 y=350 color=#60a5fa
Write short punchy text. Scene set - go!`,
  },
  {
    label: "Alien Grocery",
    icon: "\u{1F6F8}",
    prompt: `Set the scene: An alien visiting a human grocery store for the first time.
createFrame "MegaMart - Aisle 7" x=50 y=80 width=900 height=600
Create character stickies inside the frame:
createStickyNote "Zorblex the alien - has 6 arms, still can't figure out the self-checkout" x=60 y=120 color=#4ade80
createStickyNote "Store employee - trying very hard to be helpful and not scream" x=280 y=120 color=#60a5fa
createStickyNote "Regular shopper - pretending nothing unusual is happening" x=500 y=120 color=#fbbf24
Create prop stickies:
createStickyNote "A watermelon - Zorblex thinks it's an egg" x=60 y=350 color=#f87171
createStickyNote "Loyalty card - Zorblex tries to eat it" x=280 y=350 color=#c084fc
createStickyNote "Shopping cart with one wheel that squeaks interdimensionally" x=500 y=350 color=#fb923c
Write short punchy text. Scene set - go!`,
  },
  {
    label: "Time Travel Cafe",
    icon: "\u231A",
    prompt: `Set the scene: A cafe where every customer is from a different time period.
createFrame "The Temporal Grind - Est. All Years" x=50 y=80 width=900 height=600
Create character stickies inside the frame:
createStickyNote "Victorian gentleman - appalled by oat milk" x=60 y=120 color=#c084fc
createStickyNote "Barista from 2847 - confused by cash money" x=280 y=120 color=#60a5fa
createStickyNote "Medieval knight - ordered a 'potion of wakefulness'" x=500 y=120 color=#fbbf24
Create prop stickies:
createStickyNote "A menu with prices in 14 different currencies (and 3 barter options)" x=60 y=350 color=#f87171
createStickyNote "WiFi password written in hieroglyphics" x=280 y=350 color=#4ade80
createStickyNote "A tip jar that's also a time capsule" x=500 y=350 color=#fb923c
Write short punchy text. Scene set - go!`,
  },
  {
    label: "Superhero HOA",
    icon: "\u{1F9B8}",
    prompt: `Set the scene: A homeowners association meeting for superheroes.
createFrame "Heroes' Landing HOA - Monthly Meeting" x=50 y=80 width=900 height=600
Create character stickies inside the frame:
createStickyNote "HOA President (laser eyes) - keeps accidentally melting the gavel" x=60 y=120 color=#f87171
createStickyNote "The Invisible Woman - nobody can tell if she's here" x=280 y=120 color=#60a5fa
createStickyNote "Guy who controls weather - blamed for every bad BBQ" x=500 y=120 color=#fbbf24
Create prop stickies:
createStickyNote "Noise complaint: 'Someone keeps breaking the sound barrier at 3am'" x=60 y=350 color=#fb923c
createStickyNote "Agenda item: 'Capes in the pool filter AGAIN'" x=280 y=350 color=#c084fc
createStickyNote "Parking dispute - the Batmobile takes up 4 spaces" x=500 y=350 color=#4ade80
Write short punchy text. Scene set - go!`,
  },
  {
    label: "Pirate Therapy",
    icon: "\u{1F3F4}\u200D\u2620\uFE0F",
    prompt: `Set the scene: A group therapy session for retired pirates.
createFrame "Anchors Aweigh Wellness Center" x=50 y=80 width=900 height=600
Create character stickies inside the frame:
createStickyNote "Therapist - keeps saying 'and how did that make you feel' to people who say 'ARRR'" x=60 y=120 color=#60a5fa
createStickyNote "Captain Blackbeard - having trouble with landlocked retirement" x=280 y=120 color=#c084fc
createStickyNote "One-Eyed Peggy - refuses to do trust falls" x=500 y=120 color=#fbbf24
Create prop stickies:
createStickyNote "A comfort parrot that repeats your trauma back to you" x=60 y=350 color=#4ade80
createStickyNote "Stress ball shaped like a cannonball" x=280 y=350 color=#f87171
createStickyNote "Box of tissues and a treasure map to 'inner peace'" x=500 y=350 color=#fb923c
Write short punchy text. Scene set - go!`,
  },
];
