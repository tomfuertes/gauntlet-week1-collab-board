import { test, expect } from "@playwright/test";
import { signUp, createBoard, navigateToBoard } from "./helpers";

test.describe("Board CRUD", () => {
  test("create board -> appears in list", async ({ context, page }) => {
    await signUp(context);
    await page.goto("/");
    await expect(page.locator("text=Your Boards")).toBeVisible();

    await page.click("text=+ Create New Board");
    // New board navigates directly to the board canvas
    await page.waitForSelector('span[title="connected"]', { timeout: 10_000 });

    // Navigate back via hash (click can be intercepted by canvas overlay)
    await page.goto("/");
    await expect(page.locator("text=Untitled Board")).toBeVisible();
  });

  test("navigate to board -> canvas + WS connected", async ({
    context,
    page,
  }) => {
    await signUp(context);
    const boardId = await createBoard(context);
    await navigateToBoard(page, boardId);

    await expect(page.locator("canvas").first()).toBeVisible();
    await expect(page.locator('span[title="connected"]')).toBeVisible();
  });

  test("delete board -> removed from list", async ({ context, page }) => {
    await signUp(context);
    await createBoard(context, "Delete Me Board");

    await page.goto("/");
    await expect(page.locator("text=Delete Me Board")).toBeVisible();

    // Handle the confirm() dialog
    page.on("dialog", (d) => d.accept());
    // Click the Delete button (not the board name which contains "Delete")
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.locator("text=Delete Me Board")).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("navigate back from board -> board list shows", async ({
    context,
    page,
  }) => {
    await signUp(context);
    const boardId = await createBoard(context);
    await navigateToBoard(page, boardId);

    // Navigate back via hash (click can be intercepted by canvas overlay)
    await page.goto("/");
    await expect(page.locator("text=Your Boards")).toBeVisible();
  });
});
