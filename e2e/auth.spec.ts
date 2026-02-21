import { test, expect } from "@playwright/test";

test.describe("Auth", () => {
  test("sign up new user -> lands on board list", async ({ page }) => {
    await page.goto("/");
    await page.click("text=Use password instead");
    await page.click("text=Need an account? Sign up");
    const u = `e2e-signup-${Date.now()}`;
    await page.fill('input[placeholder="Username"]', u);
    await page.fill('input[placeholder="Password"]', "testpass1234");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Your Boards")).toBeVisible({
      timeout: 5000,
    });
  });

  test("login with existing user -> lands on board list", async ({ page, context }) => {
    // Create user via API first
    const username = `e2e-login-${Date.now()}`;
    await context.request.post("/auth/signup", {
      data: { username, password: "testpass1234" },
    });
    await context.clearCookies();

    await page.goto("/");
    await page.click("text=Use password instead");
    await page.fill('input[placeholder="Username"]', username);
    await page.fill('input[placeholder="Password"]', "testpass1234");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Your Boards")).toBeVisible({
      timeout: 5000,
    });
  });

  test("session persists across page reload", async ({ page }) => {
    await page.goto("/");
    await page.click("text=Use password instead");
    await page.click("text=Need an account? Sign up");
    const u = `e2e-sess-${Date.now()}`;
    await page.fill('input[placeholder="Username"]', u);
    await page.fill('input[placeholder="Password"]', "testpass1234");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Your Boards")).toBeVisible({
      timeout: 5000,
    });

    await page.reload();
    await expect(page.locator("text=Your Boards")).toBeVisible({
      timeout: 5000,
    });
  });

  test("logout -> returns to login form", async ({ page }) => {
    await page.goto("/");
    await page.click("text=Use password instead");
    await page.click("text=Need an account? Sign up");
    const u = `e2e-logout-${Date.now()}`;
    await page.fill('input[placeholder="Username"]', u);
    await page.fill('input[placeholder="Password"]', "testpass1234");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Your Boards")).toBeVisible({
      timeout: 5000,
    });

    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page.locator("text=Use password instead")).toBeVisible({
      timeout: 10_000,
    });
  });
});
