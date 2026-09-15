import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("every neon style can be picked", async ({ page }) => {
  await page.getByRole("button", { name: /Neon style/ }).click();
  const options = page.getByRole("radio");
  await expect(options).toHaveCount(4);

  await page.getByRole("radio", { name: "Halo" }).click();
  await expect(page.getByRole("button", { name: "Neon style: Halo" })).toBeVisible();
});

test("a gradient ink can be picked and is remembered", async ({ page }) => {
  await page.getByRole("button", { name: /Ink colour/ }).click();
  await page.getByRole("radio", { name: "Sunset" }).click();
  await expect(page.getByRole("button", { name: "Ink colour: Sunset" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Ink colour: Sunset" })).toBeVisible();
});

test("colour and size selections persist across a reload", async ({ page }) => {
  await page.getByRole("button", { name: /Ink colour/ }).click();
  await page.getByRole("radio", { name: "Lagoon" }).click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Brush size/ }).click();
  await page.getByRole("slider", { name: "Brush size" }).fill("28");
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(page.getByRole("button", { name: "Ink colour: Lagoon" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Brush size: 28" })).toBeVisible();
});

test("a corrupted stored brush falls back to the defaults", async ({ page }) => {
  await page.addInitScript(() =>
    window.localStorage.setItem("drawing.brush", '{"styleId":"../../etc","size":99999}'),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Neon style: Classic" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Brush size: 48" })).toBeVisible();
});

test("an animation can be chosen and is remembered", async ({ page }) => {
  await page.getByRole("button", { name: /Animation/ }).click();
  await expect(
    page.getByRole("radiogroup", { name: "Animation" }).getByRole("radio"),
  ).toHaveCount(6);
  // Speed is a play-mode control, so the animation panel holds effects only.
  await expect(page.getByRole("slider", { name: "Replay speed" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Sparkle" }).click();
  // Picking closes the panel; there is nothing else to do in it.
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Animation: Sparkle" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Animation: Sparkle" })).toBeVisible();
});

test("panels close on Escape and on an outside click", async ({ page }) => {
  const trigger = page.getByRole("button", { name: /Ink colour/ });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await trigger.click();
  await page.locator("canvas.surface").click({ position: { x: 40, y: 40 } });
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("arrow keys move through a radio group and change the selection", async ({ page }) => {
  await page.getByRole("button", { name: /Neon style/ }).click();
  await expect(page.getByRole("radio", { name: "Classic" })).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Neon style: Halo" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Halo" })).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "Neon style: Classic" })).toBeVisible();

  // Wraps backwards to the last option.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "Neon style: Wire" })).toBeVisible();

  await page.keyboard.press("Home");
  await expect(page.getByRole("button", { name: "Neon style: Classic" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "Neon style: Wire" })).toBeVisible();
});

test("only the selected radio is a tab stop", async ({ page }) => {
  await page.getByRole("button", { name: /Ink colour/ }).click();
  const stops = await page
    .getByRole("radio")
    .evaluateAll((nodes) => nodes.filter((n) => n.getAttribute("tabindex") === "0").length);
  expect(stops).toBe(1);
});

test("closing a panel returns focus to its trigger", async ({ page }) => {
  const trigger = page.getByRole("button", { name: /Ink colour/ });
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("the toolbar fits the viewport on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await page.locator(".toolbar").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
