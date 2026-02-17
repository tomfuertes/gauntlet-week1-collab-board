import { test, expect } from "@playwright/test";
import {
  signUp,
  createBoard,
  navigateToBoard,
  createObjectsViaWS,
  waitForObjectCount,
  getObjectCount,
} from "./helpers";

test.describe("Performance", () => {
  test.setTimeout(60_000);

  test("rapid creation: 100 objects via WebSocket", async ({
    context,
    page,
  }) => {
    await signUp(context);
    const boardId = await createBoard(context);
    await navigateToBoard(page, boardId);

    const start = Date.now();

    // Bulk-create 100 objects via a second WebSocket from the page
    await createObjectsViaWS(page, boardId, 100);

    // Wait for all 100 objects to render on the canvas
    await waitForObjectCount(page, 100, 30_000);
    const elapsed = Date.now() - start;

    const count = await getObjectCount(page);
    expect(count).toBeGreaterThanOrEqual(100);

    // Log timing for visibility
    console.log(`100 objects created and rendered in ${elapsed}ms`);

    await page.screenshot({ path: "test-results/perf-100-objects.png" });
  });

  test("5 concurrent users on same board", async ({ browser }) => {
    const contexts = await Promise.all(
      Array.from({ length: 5 }, () =>
        browser.newContext({ baseURL: "http://localhost:5175" }),
      ),
    );

    // Sign up all 5 users in parallel
    await Promise.all(contexts.map((ctx) => signUp(ctx)));

    // Create a shared board from user 0
    const boardId = await createBoard(contexts[0]);

    // Create pages and navigate users to the same board (staggered to avoid overwhelming DO)
    const pages = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    for (const p of pages) {
      await navigateToBoard(p, boardId);
    }

    // Each user creates one object via programmatic WS (avoids local wrangler WS drop race)
    for (let i = 0; i < 5; i++) {
      await createObjectsViaWS(pages[i], boardId, 1);
      // Brief pause to let the DO process and broadcast
      await pages[i].waitForTimeout(200);
    }

    // Verify all 5 objects are visible on every page
    await Promise.all(
      pages.map((p) => waitForObjectCount(p, 5, 20_000)),
    );

    // Wait for any extra WS connections from createObjectsViaWS to close
    await pages[0].waitForTimeout(1000);

    // Verify presence: at least 5 users shown in header
    // Presence avatars are single-letter spans with a title attribute (username)
    // Note: extra WS connections from createObjectsViaWS may briefly inflate the count,
    // so we check >= 5, not exactly 5.
    const avatars = pages[0].locator(
      'div[style*="display: flex"] > span[title][style*="border-radius: 50%"]',
    );
    const avatarCount = await avatars.count();
    expect(avatarCount).toBeGreaterThanOrEqual(5);

    await pages[0].screenshot({
      path: "test-results/5-users-presence.png",
    });

    await Promise.all(contexts.map((ctx) => ctx.close()));
  });
});
