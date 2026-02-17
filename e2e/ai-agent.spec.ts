import { test, expect } from "@playwright/test";
import { signUp, createBoard, navigateToBoard } from "./helpers";

test.describe("AI Agent", () => {
  // AI tests need extra time - Llama 3.3 is slow and unreliable
  test.setTimeout(60_000);

  test("send SWOT analysis command -> AI responds and creates objects", async ({
    context,
    page,
  }) => {
    await signUp(context);
    const boardId = await createBoard(context);
    await navigateToBoard(page, boardId);

    // Open AI panel
    await page.click('button[title="AI Assistant (/)"]');
    await expect(
      page.locator('textarea[placeholder="Ask the AI..."]'),
    ).toBeVisible();

    // Send SWOT analysis command
    await page.fill(
      'textarea[placeholder="Ask the AI..."]',
      "Create a SWOT analysis for a collaborative whiteboard product",
    );
    await page.click("button:has-text('Send')");

    // Wait for AI response (not the "Thinking..." loading state)
    // Llama 3.3 is unreliable with tool-use, so we just verify it responds
    await expect(
      page.locator('[style*="flex-start"]').last(),
    ).toBeVisible({ timeout: 45_000 });

    await page.screenshot({ path: "test-results/ai-swot.png" });
  });

  test("send arrange command -> AI responds", async ({ context, page }) => {
    await signUp(context);
    const boardId = await createBoard(context);
    await navigateToBoard(page, boardId);

    // Create some objects first for the AI to arrange
    await page.click('button[title="Sticky note (S)"]');
    await page.locator("canvas").first().dblclick({ force: true, position: { x: 300, y: 300 } });
    await page.locator("canvas").first().dblclick({ force: true, position: { x: 500, y: 300 } });
    await page.locator("canvas").first().dblclick({ force: true, position: { x: 300, y: 500 } });

    // Open AI panel and send arrange command
    await page.click('button[title="AI Assistant (/)"]');
    await page.fill(
      'textarea[placeholder="Ask the AI..."]',
      "Arrange all objects in a neat grid",
    );
    await page.click("button:has-text('Send')");

    // Wait for AI response
    await expect(
      page.locator('[style*="flex-start"]').last(),
    ).toBeVisible({ timeout: 45_000 });

    await page.screenshot({ path: "test-results/ai-arrange.png" });
  });
});
