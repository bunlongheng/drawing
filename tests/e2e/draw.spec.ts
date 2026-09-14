import { expect, test, type Page } from "@playwright/test";

/**
 * Number of non-black pixels on the canvas - how we assert that ink landed.
 * The engine composites in `requestAnimationFrame`, so settle two frames first.
 */
async function litPixels(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    await frame();
    await frame();
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) lit += 1;
    }
    return lit;
  });
}

/**
 * Drive the canvas with synthetic pointer events. Playwright's mouse helpers
 * cannot set `pointerType` or `pressure`, both of which the engine branches on.
 */
async function stroke(
  page: Page,
  options: { pointerType?: string; pressure?: number; from?: [number, number]; length?: number } = {},
): Promise<void> {
  const { pointerType = "mouse", pressure = 0.5, from = [120, 200], length = 180 } = options;
  await page.evaluate(
    ({ pointerType, pressure, from, length }) => {
      const canvas = document.querySelector("canvas") as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const fire = (type: string, x: number, y: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType,
            pressure,
            isPrimary: true,
            bubbles: true,
            clientX: rect.left + x,
            clientY: rect.top + y,
          }),
        );
      fire("pointerdown", from[0], from[1]);
      for (let i = 1; i <= 40; i += 1) {
        fire("pointermove", from[0] + (i / 40) * length, from[1] + Math.sin(i / 6) * 40);
      }
      fire("pointerup", from[0] + length, from[1]);
    },
    { pointerType, pressure, from, length },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("img", { name: "Neon drawing canvas" })).toBeVisible();
});

test("starts on an empty black canvas with the export actions disabled", async ({ page }) => {
  expect(await litPixels(page)).toBe(0);
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Share" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("a pen stroke paints neon and enables the actions", async ({ page }) => {
  await stroke(page, { pointerType: "pen", pressure: 0.9 });
  expect(await litPixels(page)).toBeGreaterThan(500);
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("pressure drives stroke width", async ({ page }) => {
  await stroke(page, { pointerType: "pen", pressure: 0.1 });
  const light = await litPixels(page);
  await page.getByRole("button", { name: "Clear canvas" }).click();
  await page.getByRole("button", { name: "Confirm clear canvas" }).click();

  await stroke(page, { pointerType: "pen", pressure: 1 });
  expect(await litPixels(page)).toBeGreaterThan(light);
});

test("ignores touch once a pen has been used, so a resting palm draws nothing", async ({ page }) => {
  await stroke(page, { pointerType: "pen", from: [120, 160] });
  const afterPen = await litPixels(page);

  await stroke(page, { pointerType: "touch", from: [120, 320] });
  expect(await litPixels(page)).toBe(afterPen);
});

test("undo, redo and clear", async ({ page }) => {
  await stroke(page);
  const drawn = await litPixels(page);
  expect(drawn).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Undo" }).click();
  expect(await litPixels(page)).toBe(0);

  await page.getByRole("button", { name: "Redo" }).click();
  expect(await litPixels(page)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Clear canvas" }).click();
  await page.getByRole("button", { name: "Confirm clear canvas" }).click();
  expect(await litPixels(page)).toBe(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("clear needs a second tap to confirm", async ({ page }) => {
  await stroke(page);
  await page.getByRole("button", { name: "Clear canvas" }).click();
  expect(await litPixels(page)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Confirm clear canvas" })).toBeVisible();
});

test("touch draws when no pen has been used", async ({ page }) => {
  await stroke(page, { pointerType: "touch" });
  expect(await litPixels(page)).toBeGreaterThan(500);
});

test("a second pointer during a stroke is ignored", async ({ page }) => {
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const fire = (type: string, id: number, x: number, y: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: "touch",
          pressure: 0.5,
          isPrimary: id === 1,
          bubbles: true,
          clientX: rect.left + x,
          clientY: rect.top + y,
        }),
      );
    fire("pointerdown", 1, 100, 100);
    fire("pointermove", 1, 160, 100);
    // A second finger must not start or extend anything.
    fire("pointerdown", 2, 100, 400);
    fire("pointermove", 2, 300, 400);
    fire("pointerup", 2, 300, 400);
    fire("pointerup", 1, 160, 100);
  });
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await litPixels(page)).toBe(0);
});

test("artwork survives a viewport change, and undo still works after it", async ({ page }) => {
  await stroke(page, { pointerType: "pen", pressure: 0.9 });
  expect(await litPixels(page)).toBeGreaterThan(500);

  await page.setViewportSize({ width: 700, height: 900 });
  expect(await litPixels(page)).toBeGreaterThan(500);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

  await page.getByRole("button", { name: "Undo" }).click();
  expect(await litPixels(page)).toBe(0);
});

test("keyboard undo and redo", async ({ page }) => {
  await stroke(page);
  const modifier = process.platform === "darwin" ? "Meta" : "Control";

  await page.keyboard.press(`${modifier}+z`);
  expect(await litPixels(page)).toBe(0);

  await page.keyboard.press(`${modifier}+Shift+z`);
  expect(await litPixels(page)).toBeGreaterThan(0);
});

test("Cmd+S saves a PNG", async ({ page }) => {
  await stroke(page);
  const download = page.waitForEvent("download");
  await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+s`);
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});

test("download produces a PNG named for the moment it was saved", async ({ page }) => {
  await stroke(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  expect((await download).suggestedFilename()).toMatch(/^neon-\d{4}-\d{2}-\d{2}-\d{6}\.png$/);
  await expect(page.getByRole("status")).toHaveText("Saved as PNG");
});

test("share hands the file to the native sheet when the platform offers one", async ({ page }) => {
  await page.evaluate(() => {
    const nav = navigator as Navigator & {
      canShare?: unknown;
      share?: unknown;
      __shared?: string[];
    };
    nav.__shared = [];
    nav.canShare = () => true;
    nav.share = (data: { files: File[] }) => {
      nav.__shared!.push(data.files[0].name);
      return Promise.resolve();
    };
  });
  await stroke(page);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("status")).toHaveText("Shared");

  const shared = await page.evaluate(
    () => (navigator as Navigator & { __shared?: string[] }).__shared,
  );
  expect(shared).toHaveLength(1);
  expect(shared![0]).toMatch(/^neon-.+\.png$/);
});

test("a dismissed share sheet is not reported as shared", async ({ page }) => {
  await page.evaluate(() => {
    const nav = navigator as Navigator & { canShare?: unknown; share?: unknown };
    nav.canShare = () => true;
    nav.share = () => Promise.reject(new DOMException("cancelled", "AbortError"));
  });
  await stroke(page);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("button", { name: "Share" })).toBeEnabled();
  await expect(page.getByRole("status")).toHaveText("");
});

test("a failed share still gets the drawing to the user as a download", async ({ page }) => {
  await page.evaluate(() => {
    const nav = navigator as Navigator & { canShare?: unknown; share?: unknown };
    nav.canShare = () => true;
    nav.share = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
  });
  await stroke(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await expect(page.getByRole("status")).toHaveText("Saved as PNG");
});

test("an export that cannot encode surfaces an error and stays usable", async ({ page }) => {
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback) {
      callback(null);
    };
  });
  await stroke(page);
  await page.getByRole("button", { name: "Download PNG" }).click();
  await expect(page.getByRole("status")).toHaveText("Export failed - please try again");
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeEnabled();
});

test("share falls back to a download where the platform cannot share files", async ({ page }) => {
  await page.evaluate(() => {
    (navigator as Navigator & { canShare?: unknown }).canShare = () => false;
  });
  await stroke(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await expect(page.getByRole("status")).toHaveText("Saved as PNG");
});
