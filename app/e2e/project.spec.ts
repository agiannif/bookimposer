// Saving a project and opening it again.
//
// data-testids used here:
//   save-project     the workspace's save button (downloads <pdf-name>.bookcomposer.json)
//   open-project     the start screen's button for opening a project file
//   choose-pdf       the PDF input shown after a project is opened
//   project-error    the start screen's message for an unreadable project
//   project-warning  one warning about the chosen PDF differing from the saved one
//   dismiss-warnings the workspace's button that hides those warnings
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { BOOK_76, FIRST_BUILD_MS, fixture, openWithBoards } from "./open-book.ts";

test.describe.configure({ timeout: FIRST_BUILD_MS + 30_000 });

const BOOK_74 = fixture("book-74.pdf");

async function saveProject(page: Page): Promise<string> {
  const download = page.waitForEvent("download");
  await page.getByTestId("save-project").click();
  const d = await download;
  expect(d.suggestedFilename()).toBe("book-76.bookcomposer.json");
  return (await d.path())!;
}

async function openProject(page: Page, projectPath: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("open-project").click();
  await (await chooser).setFiles(projectPath);
}

test("a saved project reopens with the same PDF into the workspace without warnings", async ({ page }) => {
  const errors = await openWithBoards(page);
  const path = await saveProject(page);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  expect(saved.pdf).toMatchObject({ name: "book-76.pdf", pageCount: 76 });
  expect(saved.pdf.sha256).toMatch(/^[0-9a-f]{64}$/);

  await page.goto("/");
  await openProject(page, path);
  await expect(page.getByText("Choose book-76.pdf to continue")).toBeVisible();
  await page.getByTestId("choose-pdf").setInputFiles(BOOK_76);
  await expect(page.getByTestId("export-pdf")).toBeVisible({ timeout: FIRST_BUILD_MS });
  await expect(page.getByTestId("signatures")).toHaveValue("9");
  await expect(page.getByTestId("part-item")).toHaveCount(3);
  await expect(page.getByTestId("allocation-segment")).toContainText(["1–2", "3–74", "75–76"]);
  await expect(page.getByTestId("project-warning")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("choosing a different PDF shows both warnings, which can be dismissed", async ({ page }) => {
  const errors = await openWithBoards(page);
  const path = await saveProject(page);

  await page.goto("/");
  await openProject(page, path);
  await page.getByTestId("choose-pdf").setInputFiles(BOOK_74);
  await expect(page.getByTestId("export-pdf")).toBeVisible({ timeout: FIRST_BUILD_MS });
  await expect(page.getByTestId("project-warning")).toHaveText([
    "This PDF is different from the one saved with the project",
    "It has 74 pages, the project expects 76",
  ]);
  await page.getByTestId("dismiss-warnings").click();
  await expect(page.getByTestId("project-warning")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("an unreadable project shows its error and stays on the start screen", async ({ page }) => {
  await page.goto("/");
  await openProject(page, fixture("README.md"));
  await expect(page.getByTestId("project-error")).toContainText("not valid JSON");
  await expect(page.getByTestId("open-pdf")).toBeAttached();
});
