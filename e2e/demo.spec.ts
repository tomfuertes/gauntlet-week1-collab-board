import { test, type Page } from "@playwright/test";

const baseURL = `http://localhost:${process.env.VITE_PORT || 5173}`;

/**
 * Visual demo: Alice and Bob collaborate on a board using AI commands.
 * Run with: npm run demo
 */
test.describe("Demo: Alice & Bob", () => {
  test.setTimeout(120_000);

  test("AI-powered collaboration", async ({ browser }) => {
    const suffix = Date.now().toString(36);

    // --- Setup: two users, one board ---
    const alice = await browser.newContext({ baseURL });
    const bob = await browser.newContext({ baseURL });

    const alicePage = await alice.newPage();
    const bobPage = await bob.newPage();

    // Sign up Alice
    await alicePage.goto("/");
    await alicePage.click("text=Need an account? Sign up");
    await alicePage.fill('input[placeholder="Username"]', `Alice-${suffix}`);
    await alicePage.fill('input[placeholder="Password"]', "demo1234");
    await alicePage.click('button[type="submit"]');
    await alicePage.waitForSelector("text=Your Boards", { timeout: 10_000 });

    // Alice creates a board
    await alicePage.click("text=+ New Board");
    await alicePage.waitForSelector('span[title="connected"]', { timeout: 15_000 });

    // Grab the board ID from the URL hash
    const hash = new URL(alicePage.url()).hash;
    const boardId = hash.replace("#board/", "");

    // Sign up Bob
    await bobPage.goto("/");
    await bobPage.click("text=Need an account? Sign up");
    await bobPage.fill('input[placeholder="Username"]', `Bob-${suffix}`);
    await bobPage.fill('input[placeholder="Password"]', "demo1234");
    await bobPage.click('button[type="submit"]');
    await bobPage.waitForSelector("text=Your Boards", { timeout: 10_000 });

    // Bob joins Alice's board
    await bobPage.goto(`/#board/${boardId}`);
    await bobPage.waitForSelector('span[title="connected"]', { timeout: 15_000 });

    // --- Phase 1: Parallel AI commands ---
    // Alice: create sticky notes with product ideas
    // Bob: create a 2x2 grid of frames
    await alicePage.bringToFront();
    await pause(500);

    const [aliceResult, bobResult] = await Promise.all([
      sendAIChat(alicePage, "Create 4 sticky notes with product ideas for a tech startup, use different colors"),
      sendAIChat(bobPage, "Create a 2x2 grid of frames: Q1 Revenue, Q2 Growth, Q3 Costs, Q4 Strategy"),
    ]);

    console.log(`Alice AI: ${aliceResult ? "done" : "timeout"}, Bob AI: ${bobResult ? "done" : "timeout"}`);

    // --- Phase 2: Bob organizes stickies into frames ---
    await bobPage.bringToFront();
    await pause(1000);

    await sendAIChat(bobPage, "Read the board and move all sticky notes into the frames by relevance - product ideas about revenue into Q1, growth into Q2, costs into Q3, strategy into Q4");

    // --- Phase 3: Show sync between views ---
    await pause(1000);
    await alicePage.bringToFront();
    await pause(2000);
    await bobPage.bringToFront();
    await pause(2000);

    // Pause for viewing
    await pause(8000);

    await alice.close();
    await bob.close();
  });
});

// --- helpers ---

function pause(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendAIChat(page: Page, prompt: string): Promise<boolean> {
  await page.waitForSelector('textarea[placeholder="Ask the AI..."]', { timeout: 10_000 });
  await page.click('textarea[placeholder="Ask the AI..."]');
  await page.keyboard.type(prompt, { delay: 30 });
  await pause(300);
  await page.click("button:has-text('Send')");

  // Wait for AI processing to start (bouncing dots or pulse text)
  try {
    await page.waitForSelector(".chat-bounce-dots, .chat-pulse-text", { timeout: 10_000 });
  } catch {
    // AI may have already finished before we checked
    return true;
  }

  // Wait for AI processing to finish (loading indicator disappears)
  try {
    await page.waitForSelector(".chat-bounce-dots, .chat-pulse-text", {
      state: "detached",
      timeout: 60_000,
    });
    return true;
  } catch {
    console.warn(`AI chat timed out for prompt: "${prompt.slice(0, 50)}..."`);
    return false;
  }
}
