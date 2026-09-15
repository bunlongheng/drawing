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
    const canvas = document.querySelector("canvas.surface") as HTMLCanvasElement;
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
      const canvas = document.querySelector("canvas.surface") as HTMLCanvasElement;
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

/**
 * Draw something and enter play mode, where the export actions live. The
 * replay runs on entry; the exports sit under it the whole time.
 */
async function enterPlayMode(page: Page): Promise<void> {
  await stroke(page);
  await page.getByRole("button", { name: "Replay the drawing" }).click();
  await expect(page.getByRole("button", { name: "Leave play mode" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("img", { name: "Neon drawing canvas" })).toBeVisible();
});

test("starts on an empty black canvas with nothing to play or undo", async ({ page }) => {
  expect(await litPixels(page)).toBe(0);
  await expect(page.getByRole("button", { name: "Replay the drawing" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  // Exporting belongs to play mode, so it is not on the drawing bar at all.
  await expect(page.getByRole("button", { name: "Download PNG" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
});

test("a pen stroke paints neon and enables the actions", async ({ page }) => {
  await stroke(page, { pointerType: "pen", pressure: 0.9 });
  expect(await litPixels(page)).toBeGreaterThan(500);
  await expect(page.getByRole("button", { name: "Replay the drawing" })).toBeEnabled();
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

test("the core stays saturated along a whole curved stroke", async ({ page }) => {
  // Counting lit pixels cannot see a few hundred missing out of thirty
  // thousand, so walk the path itself and assert the hot core is there at
  // every step. The stroke spans many frames, because each frame re-blooms
  // only what moved since the last one.
  const dark = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas.surface") as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const midY = rect.height / 2;
    const from = 70;
    const to = Math.round(rect.width) - 70;
    const amplitude = Math.min(140, rect.height / 3);
    const at = (x: number) =>
      midY + Math.sin(((x - from) / (to - from)) * Math.PI * 2) * amplitude;

    const fire = (type: string, x: number, y: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: "pen",
          pressure: 0.9,
          isPrimary: true,
          bubbles: true,
          clientX: rect.left + x,
          clientY: rect.top + y,
        }),
      );

    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

    fire("pointerdown", from, at(from));
    for (let x = from + 2; x <= to; x += 2) {
      fire("pointermove", x, at(x));
      if (x % 24 === 0) await frame();
    }
    fire("pointerup", to, at(to));
    await frame();
    await frame();

    // A clean core saturates to white (255 x 3). The soft bloom alone reads a
    // few hundred, so anything short of saturation means core pixels are gone.
    const ctx = canvas.getContext("2d")!;
    const scale = canvas.width / rect.width;
    const misses: number[] = [];
    for (let x = from + 14; x <= to - 14; x += 3) {
      const px = ctx.getImageData(
        Math.round(x * scale),
        Math.round(at(x) * scale),
        1,
        1,
      ).data;
      if (px[0] + px[1] + px[2] < 700) misses.push(x);
    }
    return misses;
  });

  expect(dark, `unlit points on the stroke: ${dark.slice(0, 12).join(", ")}`).toEqual([]);
});

test("a quick tap leaves nothing, a held press leaves a dot", async ({ page }) => {
  const tap = (hold: number) =>
    page.evaluate(async (ms) => {
      const canvas = document.querySelector("canvas.surface") as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const fire = (type: string) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: "pen",
            pressure: 0.9,
            isPrimary: true,
            bubbles: true,
            clientX: rect.left + 200,
            clientY: rect.top + 200,
          }),
        );
      fire("pointerdown");
      await new Promise((resolve) => setTimeout(resolve, ms));
      fire("pointerup");
    }, hold);

  await tap(20);
  expect(await litPixels(page)).toBe(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await tap(320);
  expect(await litPixels(page)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("touch draws when no pen has been used", async ({ page }) => {
  await stroke(page, { pointerType: "touch" });
  expect(await litPixels(page)).toBeGreaterThan(500);
});

test("a second pointer during a stroke is ignored", async ({ page }) => {
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas.surface") as HTMLCanvasElement;
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

test("undoing back past a checkpoint clears the canvas completely", async ({ page }) => {
  // Undo resumes from a snapshot taken every 20 strokes; crossing that
  // boundary takes a different code path, and a stale snapshot would leave
  // pixels behind.
  await page.evaluate(async () => {
    const canvas = document.querySelector("canvas.surface") as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: "pen",
          pressure: 0.7,
          isPrimary: true,
          bubbles: true,
          clientX: rect.left + x,
          clientY: rect.top + y,
        }),
      );
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let i = 0; i < 25; i += 1) {
      const x = 40 + (i % 8) * 30;
      const y = 40 + Math.floor(i / 8) * 40;
      fire("pointerdown", x, y);
      for (let k = 1; k <= 5; k += 1) fire("pointermove", x + k * 4, y + k);
      fire("pointerup", x + 20, y + 5);
      if (i % 5 === 0) await frame();
    }
    await frame();
  });
  expect(await litPixels(page)).toBeGreaterThan(500);

  const undo = page.getByRole("button", { name: "Undo" });
  for (let i = 0; i < 25; i += 1) await undo.click();

  await expect(undo).toBeDisabled();
  expect(await litPixels(page)).toBe(0);
});

test("play mode locks the canvas so a stray tap leaves no dots", async ({ page }) => {
  // Animation off, so the pixel count is stable and the lock is the only variable.
  await page.getByRole("button", { name: /Animation/ }).click();
  await page.getByRole("radio", { name: "Off" }).click();
  await page.keyboard.press("Escape");

  await stroke(page, { pointerType: "pen", pressure: 0.9 });
  const drawn = await litPixels(page);
  expect(drawn).toBeGreaterThan(500);

  await page.getByRole("button", { name: "Replay the drawing" }).click();
  await expect(page.getByRole("button", { name: "Stop replay" })).toBeVisible();

  // Try hard to draw while it plays.
  await stroke(page, { pointerType: "pen", from: [80, 300], length: 260 });
  await stroke(page, { pointerType: "touch", from: [80, 360], length: 260 });

  // Let it finish, then compare: mid-replay the canvas is legitimately partial.
  await expect(page.getByRole("button", { name: "Replay the drawing" })).toBeVisible({
    timeout: 20_000,
  });
  expect(await litPixels(page)).toBe(drawn);

  // Play mode holds until it is left, and the canvas is locked all the while.
  await stroke(page, { pointerType: "pen", from: [80, 420], length: 260 });
  expect(await litPixels(page)).toBe(drawn);

  await page.getByRole("button", { name: "Leave play mode" }).click();
  await stroke(page, { pointerType: "pen", from: [80, 420], length: 260 });
  expect(await litPixels(page)).toBeGreaterThan(drawn);
});

test("play mode swaps the drawing tools for the export actions", async ({ page }) => {
  await stroke(page, { pointerType: "pen" });
  await expect(page.locator(".playbar")).toBeHidden();
  await expect(page.getByRole("button", { name: /Brush size/ })).toBeVisible();

  await page.getByRole("button", { name: "Replay the drawing" }).click();
  await expect(page.locator(".playbar")).toBeVisible();
  await expect(page.getByRole("slider", { name: "Replay speed" })).toBeVisible();
  // The clip button names itself for what the browser can do: a WebKit build
  // without MediaRecorder says so instead of promising an export.
  await expect(
    page.getByRole("button", { name: /Export video|cannot record video/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
  // The drawing tools are gone while the canvas is locked.
  await expect(page.getByRole("button", { name: /Brush size/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);

  await page.getByRole("button", { name: "Leave play mode" }).click();
  await expect(page.locator(".playbar")).toBeHidden();
  await expect(page.getByRole("button", { name: /Brush size/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "Replay speed" })).toHaveCount(0);
});

test("the speed slider snaps to each speed and takes effect live", async ({ page }) => {
  await stroke(page, { pointerType: "pen" });
  // The control belongs to play mode; drawing never shows it.
  await expect(page.getByRole("slider", { name: "Replay speed" })).toHaveCount(0);

  await page.getByRole("button", { name: "Replay the drawing" }).click();
  const slider = page.getByRole("slider", { name: "Replay speed" });
  // Opens at 1x, the pace the drawing was made at.
  await expect(slider).toHaveAttribute("aria-valuetext", "1 times speed");
  await expect(slider).toHaveAttribute("min", "0");
  await expect(slider).toHaveAttribute("max", "3");
  await expect(slider).toHaveAttribute("step", "1");

  for (const [index, speed] of ["0.1", "1", "2", "3"].entries()) {
    await slider.fill(String(index));
    await expect(slider).toHaveAttribute("aria-valuetext", `${speed} times speed`);
  }

  // Left at 3x, so the run in flight finishes quickly - the observable proof
  // that moving the slider reached the replay already going.
  await expect(page.getByRole("button", { name: "Replay the drawing" })).toBeVisible({
    timeout: 15_000,
  });
});

test("the chosen speed is remembered", async ({ page }) => {
  await stroke(page, { pointerType: "pen" });
  await page.getByRole("button", { name: "Replay the drawing" }).click();
  await page.getByRole("slider", { name: "Replay speed" }).fill("0");

  await page.reload();
  await expect(page.getByRole("img", { name: "Neon drawing canvas" })).toBeVisible();
  await stroke(page, { pointerType: "pen" });
  await page.getByRole("button", { name: "Replay the drawing" }).click();
  await expect(page.getByRole("slider", { name: "Replay speed" })).toHaveAttribute(
    "aria-valuetext",
    "0.1 times speed",
  );
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
  await enterPlayMode(page);
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
  await enterPlayMode(page);
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
  await enterPlayMode(page);
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
  await enterPlayMode(page);
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
  await enterPlayMode(page);
  await page.getByRole("button", { name: "Download PNG" }).click();
  await expect(page.getByRole("status")).toHaveText("Export failed - please try again");
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeEnabled();
});

test("share falls back to a download where the platform cannot share files", async ({ page }) => {
  await page.evaluate(() => {
    (navigator as Navigator & { canShare?: unknown }).canShare = () => false;
  });
  await enterPlayMode(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await expect(page.getByRole("status")).toHaveText("Saved as PNG");
});
