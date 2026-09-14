import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("every neon style can be picked", async ({ page }) => {
  await page.getByRole("button", { name: /Neon style/ }).click();
  const options = page.getByRole("radio");
  await expect(options).toHaveCount(6);

  await options.filter({ hasText: "Spectrum" }).click();
  await expect(page.getByRole("button", { name: "Neon style: Spectrum" })).toBeVisible();
});

test("colour and size selections persist across a reload", async ({ page }) => {
  await page.getByRole("button", { name: /Ink colour/ }).click();
  await page.getByRole("radio", { name: "Amber" }).click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Brush size/ }).click();
  await page.getByRole("slider", { name: "Brush size" }).fill("28");
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(page.getByRole("button", { name: "Ink colour: Amber" })).toBeVisible();
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

test("panels close on Escape and on an outside click", async ({ page }) => {
  const trigger = page.getByRole("button", { name: /Ink colour/ });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await trigger.click();
  await page.locator("canvas").click({ position: { x: 40, y: 40 } });
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("the toolbar fits the viewport on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await page.locator(".toolbar").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
