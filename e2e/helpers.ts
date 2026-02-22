import { BrowserContext, Page } from "@playwright/test";

/**
 * Sign up a unique user via API. Cookies are shared with pages in the same context.
 */
export async function signUp(context: BrowserContext) {
  const username = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const password = "testpass1234";
  const res = await context.request.post("/auth/signup", {
    data: { username, password },
  });
  if (!res.ok()) throw new Error(`Signup failed: ${res.status()}`);
  return { username, password };
}

/**
 * Create a board via API. Returns the board ID.
 */
export async function createBoard(context: BrowserContext, name?: string) {
  const res = await context.request.post("/api/boards", {
    data: { name: name || "E2E Test Board" },
  });
  if (!res.ok()) throw new Error(`Board create failed: ${res.status()}`);
  const body = await res.json();
  return body.id as string;
}

/**
 * Navigate to a board and wait for stable WebSocket connection.
 * The first WS attempt can fail on local dev; we wait for the empty-state hint
 * ("Double-click to add a sticky") which proves init was received and board is ready.
 * For boards that already have objects, we fall back to the connected indicator + delay.
 */
export async function navigateToBoard(page: Page, boardId: string) {
  await page.goto(`/#board/${boardId}`);
  // Wait for either the empty hint (fresh board, init received) or connected + stable
  try {
    await page.waitForSelector("text=Double-click to add a sticky", {
      timeout: 15_000,
    });
  } catch {
    // Board has existing objects - hint won't show. Fall back to connected check.
    await page.waitForSelector('span[title="connected"]', { timeout: 15_000 });
    await page.waitForTimeout(500);
  }
}

/**
 * Bulk-create objects via a second WebSocket connection from within the page.
 * The page's existing WS receives broadcasts and renders the objects.
 */
export async function createObjectsViaWS(page: Page, boardId: string, count: number) {
  await page.evaluate(
    ({ boardId, count }) => {
      return new Promise<void>((resolve, reject) => {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${protocol}//${location.host}/ws/board/${boardId}`);
        ws.onopen = () => {
          for (let i = 0; i < count; i++) {
            ws.send(
              JSON.stringify({
                type: "obj:create",
                obj: {
                  id: crypto.randomUUID(),
                  type: "sticky",
                  x: 100 + (i % 10) * 120,
                  y: 100 + Math.floor(i / 10) * 120,
                  width: 100,
                  height: 100,
                  rotation: 0,
                  props: { text: `Obj ${i + 1}`, color: "#FFEB3B" },
                  createdBy: "e2e-bulk",
                  updatedAt: Date.now(),
                },
              }),
            );
          }
          // Allow time for DO to process and broadcast all messages
          setTimeout(() => {
            ws.close();
            resolve();
          }, 500);
        };
        ws.onerror = () => reject(new Error("WebSocket connection failed"));
        setTimeout(() => reject(new Error("WebSocket timeout")), 10_000);
      });
    },
    { boardId, count },
  );
}

/**
 * Count board objects on the Konva stage via page.evaluate.
 * react-konva Groups have nodeType='Group' (className is undefined).
 * Grid dots are Rects (nodeType='Shape'). Transformer has className='Transformer'.
 */
export async function getObjectCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const K = (window as any).Konva;
    if (!K?.stages?.length) return 0;
    const layer = K.stages[0].children?.[0];
    if (!layer?.children) return 0;
    return layer.children.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c.nodeType === "Group" && c.className !== "Transformer",
    ).length;
  });
}

/**
 * Wait until the Konva stage has at least `count` object Groups.
 * Uses polling with page.evaluate (more reliable than waitForFunction for Konva access).
 */
export async function waitForObjectCount(page: Page, count: number, timeout = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const current = await getObjectCount(page);
    if (current >= count) return;
    await page.waitForTimeout(250);
  }
  const final = await getObjectCount(page);
  throw new Error(`Timeout waiting for ${count} objects, got ${final} after ${timeout}ms`);
}
