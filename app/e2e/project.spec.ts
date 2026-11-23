// Saving a project and opening it again.
//
// data-testids used here:
//   save-project     the workspace's save button (downloads <pdf-name>.bookcomposer.json)
//   open-project     the start screen's button for opening a project file
//   choose-pdf       the PDF input shown after a project is opened
//   project-error    the start screen's message for an unreadable project
//   open-error       the start screen's message for a PDF that could not be opened
//   cancel-project   the button that drops an opened project and goes back to the start
//   save-error       the workspace's message for a project that could not be saved
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
  await expect(page.getByTestId("signatures")).toHaveValue("10");
  await expect(page.getByTestId("part-item")).toHaveCount(3);
  await expect(page.getByTestId("allocation-segment")).toContainText(["1–2", "3–74", "75–76"]);
  await expect(page.getByTestId("project-warning")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("choosing a different PDF shows both warnings, which can be dismissed, and lays out what it can", async ({ page }) => {
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
  // The saved settings still lay out: 70 PDF pages and the two blank leaves make 74 body pages, which 10
  // signatures of 8 pad with 6 blanks. The engine doesn't flag that, so there is no issue banner and export stays on.
  await expect(page.getByTestId("signatures")).toHaveValue("10");
  await expect(page.getByTestId("allocation-segment")).toContainText(["1–2", "3–72", "73–74"]);
  await expect(page.getByTestId("allocation-segment").nth(1)).toContainText("+6 blank");
  await expect(page.getByTestId("derived-blanks-added")).toHaveText("6");
  await expect(page.locator("[data-testid=issue-error], [data-testid=issue-warning]")).toHaveCount(0);
  await expect(page.getByTestId("export-pdf")).toBeEnabled();
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

test("Cancel on the choose-PDF screen goes back to the start and clears an open error", async ({ page }) => {
  const errors = await openWithBoards(page);
  const path = await saveProject(page);
  await page.goto("/");
  await openProject(page, path);
  // A file that isn't a PDF fails to open, and its error shows under the choose-PDF button.
  await page.getByTestId("choose-pdf").setInputFiles(fixture("README.md"));
  await expect(page.getByTestId("open-error")).toContainText("Could not open README.md");
  await page.getByTestId("cancel-project").click();
  await expect(page.getByTestId("open-pdf")).toBeAttached();
  await expect(page.getByTestId("open-error")).toHaveCount(0);
  // The failed page-sizes request is the only console message the browser logs for it.
  expect(errors.filter((e) => !/Failed to load resource.*422/.test(e))).toEqual([]);
});

test("a project that can't be saved shows why and the workspace stays usable", async ({ page }) => {
  // The browser build saves by downloading a blob URL; make that fail for the project's JSON.
  await page.addInitScript(() => {
    const create = URL.createObjectURL;
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob && object.type === "application/json") throw new Error("disk full");
      return create(object);
    };
  });
  const errors = await openWithBoards(page);
  await page.getByTestId("save-project").click();
  await expect(page.getByTestId("save-error")).toHaveText("Could not save the project: disk full");
  await page.getByTestId("signatures").fill("19");
  await expect(page.getByTestId("derived-pages-per-signature")).toHaveText("4");
  expect(errors).toEqual([]);
});
