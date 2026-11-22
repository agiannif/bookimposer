import { test, expect, type Page } from "@playwright/test";

/**
 * Opens the test page for `query`, waits for its canvas to be drawn, and
 * returns its size and the RGB of the pixel at fractions `at` of its width and height.
 */
async function thumbnail(page: Page, query: string, at: [number, number]) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`/e2e/pages/thumbnails.html?${query}`);
  await expect(page.locator("canvas[data-ready], body[data-error]")).toBeAttached();
  expect(await page.locator("body").getAttribute("data-error")).toBeNull();
  expect(errors).toEqual([]);
  return page.locator("canvas").evaluate((canvas: HTMLCanvasElement, [fx, fy]) => {
    const { width, height } = canvas;
    const pixel = canvas.getContext("2d")!.getImageData(Math.round(width * fx), Math.round(height * fy), 1, 1).data;
    return { width, height, pixel: [...pixel.slice(0, 3)] };
  }, at);
}

function expectColour(actual: number[], expected: number[]) {
  actual.forEach((channel, i) => expect(Math.abs(channel - expected[i])).toBeLessThanOrEqual(8));
}

// label_colour(1) and OFF_CENTRE_BLOCK in crates/pdf-export/tests/support/mod.rs.
const PAGE_1_BACKGROUND = [101, 137, 173];
const OFF_CENTRE_BLOCK = [90, 50, 20];

test("a thumbnail of page 1 shows its background colour", async ({ page }) => {
  // Right of centre: clear of the label, the corner image and the off-centre block.
  const { width, height, pixel } = await thumbnail(page, "pdf=book-8.pdf&page=0&width=200", [0.75, 0.5]);
  expect({ width, height }).toEqual({ width: 256, height: Math.round((256 * 378) / 288) });
  expectColour(pixel, PAGE_1_BACKGROUND);
});

test("a page with /Rotate 90 renders turned, as it displays", async ({ page }) => {
  // The block sits near the top-left of the upright page, so turned a quarter clockwise it is near the top-right.
  const { width, height, pixel } = await thumbnail(page, "pdf=rotated-8.pdf&page=1&width=200", [0.75, 0.25]);
  expect({ width, height }).toEqual({ width: 256, height: Math.round((256 * 288) / 378) });
  expectColour(pixel, OFF_CENTRE_BLOCK);
});
