// Screenshots the workspace with book-76.pdf (both boards, 9 signatures) at one or more window
// sizes, for checking the layout by eye. Needs the dev server (`make app-dev`) on 127.0.0.1:5173.
//
// Usage: node scripts/screenshot-workspace.ts OUT_DIR [WIDTHxHEIGHT ...]   (default 1280x800 1100x700)
// Writes OUT_DIR/workspace-WIDTHxHEIGHT.png and prints each path, plus any horizontal overflow.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [outDir, ...sizeArgs] = process.argv.slice(2);
if (!outDir || outDir === "--help" || outDir === "-h") {
  console.error("Usage: node scripts/screenshot-workspace.ts OUT_DIR [WIDTHxHEIGHT ...]  (needs `make app-dev` running)");
  process.exit(outDir ? 0 : 2);
}
const sizes = (sizeArgs.length ? sizeArgs : ["1280x800", "1100x700"]).map((text) => {
  const match = /^(\d+)x(\d+)$/.exec(text);
  if (!match) {
    console.error(`Bad size "${text}", expected WIDTHxHEIGHT`);
    process.exit(2);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
});
const book = fileURLToPath(new URL("../e2e/fixtures/book-76.pdf", import.meta.url));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const viewport of sizes) {
    const page = await browser.newPage({ viewport });
    try {
      await page.goto("http://127.0.0.1:5173/");
    } catch {
      console.error("Could not reach http://127.0.0.1:5173. Start the dev server with `make app-dev`.");
      process.exit(1);
    }
    await page.getByTestId("open-pdf").setInputFiles(book);
    await page.getByTestId("start").waitFor({ timeout: 240_000 });
    await page.getByTestId("front-board").check();
    await page.getByTestId("back-board").check();
    await page.getByTestId("signatures").fill("9");
    await page.getByTestId("start").click();
    await page.locator("[data-testid=placement-image][href^='blob:']").first().waitFor();
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const path = join(outDir, `workspace-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path });
    console.log(`${path}${overflow > 0 ? ` (scrolls sideways by ${overflow}px)` : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
}
