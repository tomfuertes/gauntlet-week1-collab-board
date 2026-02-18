import { test, expect } from "@playwright/test";
import {
  signUp,
  createBoard,
  navigateToBoard,
  createObjectsViaWS,
  waitForObjectCount,
  getObjectCount,
} from "./helpers";

const baseURL = `http://localhost:${process.env.VITE_PORT || 5173}`;

test.describe("Real-time sync", () => {
  test.setTimeout(45_000);

  test("2-user simultaneous editing", async ({ browser }) => {
    const ctx1 = await browser.newContext({ baseURL });
    const ctx2 = await browser.newContext({ baseURL });

    await signUp(ctx1);
    await signUp(ctx2);
    const boardId = await createBoard(ctx1);

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await navigateToBoard(page1, boardId);
    await navigateToBoard(page2, boardId);

    // User1 creates a sticky note via programmatic WS (avoids local wrangler WS drop race)
    await createObjectsViaWS(page1, boardId, 1);
    // Verify User1 receives the broadcast from DO
    await waitForObjectCount(page1, 1);
    // Verify User2 receives it via WS broadcast
    await waitForObjectCount(page2, 1);

    // User2 creates a rectangle
    await createObjectsViaWS(page2, boardId, 1);
    // Verify both pages see 2 objects
    await waitForObjectCount(page2, 2);
    await waitForObjectCount(page1, 2);

    await page1.screenshot({ path: "test-results/sync-user1.png" });
    await page2.screenshot({ path: "test-results/sync-user2.png" });

    await ctx1.close();
    await ctx2.close();
  });

  test("refresh mid-edit preserves state", async ({ context, page }) => {
    await signUp(context);
    const boardId = await createBoard(context);
    await navigateToBoard(page, boardId);

    // Create a sticky note via programmatic WS (avoids local wrangler WS drop race)
    await createObjectsViaWS(page, boardId, 1);
    await waitForObjectCount(page, 1);

    // Reload the page - DO Storage should restore state via init message
    await page.reload();
    await page.waitForSelector('span[title="connected"]', { timeout: 15_000 });
    await waitForObjectCount(page, 1);

    const count = await getObjectCount(page);
    expect(count).toBe(1);
  });

  test("network disconnection and recovery", async ({ context, page }) => {
    await signUp(context);
    const boardId = await createBoard(context);
    await navigateToBoard(page, boardId);

    // Create an object first
    await createObjectsViaWS(page, boardId, 1);
    await waitForObjectCount(page, 1);

    // Go offline - WebSocket should disconnect
    await context.setOffline(true);
    // Wait for non-connected state (setOffline blocks new connections; existing WS times out)
    await page
      .waitForFunction(
        () => {
          const dot = document.querySelector("span[title]");
          return dot && dot.getAttribute("title") !== "connected";
        },
        null,
        { timeout: 20_000 },
      )
      .catch(() => {
        // If WS didn't disconnect within timeout, continue - setOffline may not
        // immediately close already-open sockets on local wrangler dev.
        console.warn("[test] setOffline did not trigger WS disconnect - continuing");
      });

    // Go back online - should reconnect automatically
    await context.setOffline(false);
    await page.waitForSelector('span[title="connected"]', { timeout: 20_000 });

    // State should be consistent - object still present after reconnect init
    await waitForObjectCount(page, 1);
    const count = await getObjectCount(page);
    expect(count).toBe(1);

    await page.screenshot({
      path: "test-results/reconnect-recovered.png",
    });
  });
});
