// Opens a fixture PDF through the start and setup screens. Shared by the workspace e2e specs.
import { expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

export const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

export const BOOK_76 = fixture("book-76.pdf");

// The first page-sizes call builds the Rust CLI, which can take minutes on a cold cache.
export const FIRST_BUILD_MS = 240_000;

/** Opens `pdf` and waits for the setup screen. Returns the page's errors and warnings so far, live. */
export async function openSetup(page: Page, pdf = BOOK_76) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
  });
  await page.goto("/");
  await page.getByTestId("open-pdf").setInputFiles(pdf, { timeout: 10_000 });
  await expect(page.getByTestId("start")).toBeVisible({ timeout: FIRST_BUILD_MS });
  return errors;
}

/** Opens `pdf` with 9 signatures and both boards, into the workspace. */
export async function openWithBoards(page: Page, pdf = BOOK_76) {
  const errors = await openSetup(page, pdf);
  await page.getByTestId("front-board").check();
  await page.getByTestId("back-board").check();
  await page.getByTestId("signatures").fill("9");
  await page.getByTestId("start").click();
  return errors;
}
