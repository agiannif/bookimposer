// Screenshots the 3D book panel for landscape-76.pdf (both boards, 10 signatures): the closed book and the
// first spread, at 1280x800 with the panel set larger. For checking the 3D preview by eye. Needs the dev
// server (`make app-dev`) on 127.0.0.1:5173.
//
// Usage: node scripts/screenshot-book.ts OUT_DIR
// Writes OUT_DIR/book-closed.png and OUT_DIR/book-open.png and prints each path, plus any page errors.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [outDir] = process.argv.slice(2);
if (!outDir || outDir === "--help" || outDir === "-h") {
  console.error("Usage: node scripts/screenshot-book.ts OUT_DIR  (needs `make app-dev` running)");
  process.exit(outDir ? 0 : 2);
}
const book = fileURLToPath(new URL("../e2e/fixtures/landscape-76.pdf", import.meta.url));
mkdirSync(outDir, { recursive: true });

// SwiftShader, as the e2e specs use: the default headless GL logs a "GPU stall due to ReadPixels" warning.
const browser = await chromium.launch({ args: ["--use-angle=swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") console.error(`console ${message.type()}: ${message.text()}`);
  });
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
  await page.getByTestId("signatures").fill("10");
  await page.getByTestId("start").click();
  await page.getByTestId("preview-wide").click();
  const panel = page.getByTestId("preview-3d");
  const shoot = async (name: string) => {
    await page.locator("[data-testid=spread-face][data-painted=true]").first().waitFor({ state: "attached" });
    await page.waitForTimeout(800);
    const path = join(outDir, `${name}.png`);
    await panel.screenshot({ path });
    console.log(path);
  };
  await shoot("book-closed");
  await page.getByTestId("spread-next").click();
  await shoot("book-open");
} finally {
  await browser.close();
}
