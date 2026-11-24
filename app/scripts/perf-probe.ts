// Times every stage of importing a PDF and exporting it, as the app experiences them (dev path: Chromium ->
// Vite dev middleware -> bookcomposer-export CLI) and without HTTP (library path: the CLI run directly).
// Run it through `make perf-probe`; `--help` lists the options. Measuring only: nothing here changes the app.
//
// Stage sources: the Rust stages come from BOOKCOMPOSER_TIMINGS=1 (JSON lines on the CLI's stderr), the
// middleware's from the same variable on the dev server, the app's from performance measures "bc:*" (set up by
// perf.ts, enabled by the init script below) read through Playwright.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { impose } from "../../engine/src/index.ts";
import { DEFAULT_SETTINGS, suggestSignatures, toBookSpec } from "../src/lib/book.ts";

const USAGE = `Usage: node scripts/perf-probe.ts --out DIR [--pdf FILE ...] [--runs N] [--port N] [--skip dev|library]

Times each stage of import and export for every --pdf (default: a generated 300-page probe with ~88 MB of
shared images, plus the landscape-76 and book-76 fixtures), RUNS times each (default 3), after one untimed
warm-up. Writes DIR/results.json (every run) and DIR/table.md (median ms per stage). The dev server for the
dev path runs on --port (default 5199), not on 5173.

Stages are named <phase>.<source>:<stage>. Phases: import, first-sheet, export, verify. Sources: wall (the
probe's own clock), bc (app), mw (dev-server middleware), cli (Rust). A value is the stage's total over the
phase, with (nN) when it ran N times.`;

interface Options { out: string; pdfs: string[]; runs: number; port: number; skip: Set<string> }

function parseArgs(argv: string[]): Options {
  const options: Options = { out: "", pdfs: [], runs: 3, port: 5199, skip: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = () => argv[++i] ?? fail(`${flag} needs a value`);
    if (flag === "--help" || flag === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (flag === "--out") options.out = resolve(value());
    else if (flag === "--pdf") options.pdfs.push(resolve(value()));
    else if (flag === "--runs") options.runs = Number(value());
    else if (flag === "--port") options.port = Number(value());
    else if (flag === "--skip") options.skip.add(value());
    else fail(`unknown option ${flag}`);
  }
  if (!options.out) fail("--out is required");
  if (!Number.isInteger(options.runs) || options.runs < 1) fail("--runs must be a whole number");
  return options;
}

function fail(message: string): never {
  console.error(`perf-probe: ${message}\n\n${USAGE}`);
  process.exit(2);
}

/** One run's stages: name -> total ms and how many times it ran. */
type Stages = Map<string, { ms: number; count: number }>;

function add(stages: Stages, name: string, ms: number): void {
  const stage = stages.get(name) ?? { ms: 0, count: 0 };
  stage.ms += ms;
  stage.count += 1;
  stages.set(name, stage);
}

/** Adds the Rust timing lines in `stderr` as `<prefix>cli:<stage>`; an accumulated stage's `count` field counts its runs. */
function addRustLines(stages: Stages, stderr: string, prefix: string): void {
  for (const line of stderr.split("\n")) {
    if (!line.startsWith("{")) continue;
    const { stage, ms, count } = JSON.parse(line) as { stage: string; ms: number; count?: number };
    add(stages, `${prefix}cli:${stage}`, ms);
    if (count !== undefined) stages.get(`${prefix}cli:${stage}`)!.count += count - 1;
  }
}

const REPO = resolve(import.meta.dirname, "../..");
const BIN = join(REPO, "target/release/bookcomposer-export");
const env = { ...process.env, BOOKCOMPOSER_TIMINGS: "1", BOOKCOMPOSER_PDFIUM_DIR: process.env.BOOKCOMPOSER_PDFIUM_DIR ?? join(REPO, "vendor/pdfium/lib") };

/** Runs the CLI, returning its wall time and stderr; a failure stops the probe. */
function runCli(args: string[]): { wall: number; stdout: string; stderr: string } {
  const start = performance.now();
  const r = spawnSync(BIN, args, { env, encoding: "utf8", maxBuffer: 1 << 30 });
  const wall = performance.now() - start;
  if (r.status !== 0) fail(`bookcomposer-export ${args.join(" ")} failed: ${r.stderr}`);
  return { wall, stdout: r.stdout, stderr: r.stderr };
}

/** The library path for `pdf`: page-sizes, the engine's layout (as the app makes it), and export, all without HTTP. */
function libraryRun(pdf: string, work: string): Stages {
  const stages: Stages = new Map();
  const sizes = runCli(["page-sizes", pdf]);
  add(stages, "page-sizes.wall:process", sizes.wall);
  addRustLines(stages, sizes.stderr, "page-sizes.");
  const { pageSizes } = JSON.parse(sizes.stdout) as { pageSizes: { width: number; height: number }[] };
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.signatures = suggestSignatures(pageSizes.length, settings);
  const start = performance.now();
  const layout = impose(toBookSpec(pageSizes, settings));
  add(stages, "export.wall:impose", performance.now() - start);
  const layoutPath = join(work, "layout.json");
  writeFileSync(layoutPath, JSON.stringify(layout));
  const output = join(work, "sheets.pdf");
  const exported = runCli(["export", "--layout", layoutPath, "--input", pdf, "--output", output, "--cut-marks", "--fold-marks"]);
  add(stages, "export.wall:process", exported.wall);
  addRustLines(stages, exported.stderr, "export.");
  return stages;
}

interface ServerLine { stage: string; ms: number; request: number; from?: string; count?: number }

/** The dev server, run by the probe so its stderr can be read. It is stopped by `stop`. */
async function startServer(port: number): Promise<{ lines: ServerLine[]; stop(): void }> {
  const rustup = process.env.RUSTUP_BIN ?? "/home/linuxbrew/.linuxbrew/opt/rustup/bin";
  const child: ChildProcess = spawn(join(REPO, "app/node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: join(REPO, "app"),
    env: { ...env, PATH: `${rustup}:${process.env.PATH}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: ServerLine[] = [];
  let tail = "";
  let log = "";
  child.stderr!.on("data", (chunk: Buffer) => {
    tail += chunk.toString();
    const parts = tail.split("\n");
    tail = parts.pop()!;
    for (const line of parts) {
      if (line.startsWith("{") && line.includes('"request":')) lines.push(JSON.parse(line) as ServerLine);
      else log += `${line}\n`;
    }
  });
  child.stdout!.on("data", (chunk: Buffer) => (log += chunk.toString()));
  const stop = () => child.kill("SIGTERM");
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return { lines, stop };
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) fail(`the dev server exited:\n${log}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  stop();
  fail(`the dev server did not start on port ${port}:\n${log}`);
}

interface Measure { name: string; ms: number; detail?: { maxWidth?: number } }

/** Takes the app's recorded measures into `stages` under `phase`, and clears them. */
async function takeAppMeasures(page: Page, stages: Stages, phase: string): Promise<void> {
  const measures = await page.evaluate((): Measure[] => {
    const found = performance.getEntriesByType("measure").filter((m) => m.name.startsWith("bc:")).map((m) => ({ name: m.name, ms: m.duration, detail: (m as PerformanceMeasure).detail }));
    performance.clearMeasures();
    return found;
  });
  for (const m of measures) {
    // Two thumbnail caches run at once (the sheet view's 1024 px and the 3D book's 2048 px); keep them apart.
    const cache = m.detail?.maxWidth !== undefined ? `[${m.detail.maxWidth}]` : "";
    add(stages, `${phase}.${m.name}${cache}`, m.ms);
  }
}

/** The dev server's lines for `request`, as stages under `phase`. */
function takeServerLines(lines: ServerLine[], request: number, stages: Stages, phase: string): void {
  for (const line of lines.filter((l) => l.request === request)) {
    const name = `${phase}.${line.from === "cli" ? "cli" : "mw"}:${line.stage}`;
    add(stages, name, line.ms);
    if (line.count !== undefined) stages.get(name)!.count += line.count - 1;
  }
}

const SETTLE_MS = 1500;
const LONG = 15 * 60_000;

/** One dev-path run: opens `pdf` in the app, starts the workspace, exports, verifies the export. */
async function devRun(pdf: string, base: string, server: { lines: ServerLine[] }, browser: Awaited<ReturnType<typeof chromium.launch>>, withVerify: boolean): Promise<Stages> {
  const stages: Stages = new Map();
  const firstLine = server.lines.length;
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(LONG);
    await page.addInitScript(() => ((globalThis as { __bookcomposerPerf?: boolean }).__bookcomposerPerf = true));
    await page.goto(base);
    const wall = async (phase: string, action: () => Promise<void>) => {
      const start = performance.now();
      await action();
      add(stages, `${phase}.wall:total`, performance.now() - start);
      console.log(`  ${basename(pdf)} ${phase}: ${Math.round(performance.now() - start)} ms`);
    };

    await wall("import", async () => {
      await page.getByTestId("open-pdf").setInputFiles(pdf);
      await page.getByTestId("start").waitFor();
    });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    await takeAppMeasures(page, stages, "import");

    await wall("first-sheet", async () => {
      await page.getByTestId("start").click();
      await page.waitForFunction(() => {
        const images = [...document.querySelectorAll("[data-testid=placement-image]")];
        return images.length > 0 && images.every((i) => i.getAttribute("href"));
      });
    });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    await takeAppMeasures(page, stages, "first-sheet");

    await wall("export", async () => {
      const download = page.waitForEvent("download");
      await page.getByTestId("export-pdf").click();
      await (await download).delete();
    });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    await takeAppMeasures(page, stages, "export");

    if (withVerify) {
      await wall("verify", async () => {
        await page.getByTestId("verify-export").click();
        await page.getByTestId("verify-result").or(page.getByTestId("check-error")).waitFor();
        const error = page.getByTestId("check-error");
        if (await error.isVisible()) fail(`Verify export failed on ${basename(pdf)}: ${await error.textContent()}`);
      });
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      await takeAppMeasures(page, stages, "verify");
    }
  } finally {
    await context.close();
  }
  await new Promise((r) => setTimeout(r, 300));
  const requests = [...new Set(server.lines.slice(firstLine).map((l) => l.request))].sort((a, b) => a - b);
  const phases = ["import", "export", ...(withVerify ? ["verify"] : [])];
  phases.forEach((phase, i) => takeServerLines(server.lines.slice(firstLine), requests[i]!, stages, phase));
  return stages;
}

const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** A markdown table: one row per stage, one column per input, each cell the median total ms. */
function table(title: string, byInput: Map<string, Stages[]>): string {
  const names = new Set<string>();
  for (const runs of byInput.values()) for (const run of runs) for (const name of run.keys()) names.add(name);
  const rows = [`### ${title}`, "", `| stage | ${[...byInput.keys()].join(" | ")} |`, `|---|${[...byInput.keys()].map(() => "---:").join("|")}|`];
  for (const name of [...names].sort()) {
    const cells = [...byInput.values()].map((runs) => {
      const have = runs.filter((r) => r.has(name));
      if (have.length === 0) return "";
      const ms = median(have.map((r) => r.get(name)!.ms));
      const count = have[0]!.get(name)!.count;
      return `${ms.toFixed(ms < 10 ? 2 : 0)}${count > 1 ? ` (n${count})` : ""}`;
    });
    rows.push(`| ${name} | ${cells.join(" | ")} |`);
  }
  return rows.join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.out, { recursive: true });
  const probe = join(options.out, "big-300.pdf");
  let pdfs = options.pdfs;
  if (pdfs.length === 0) {
    const r = spawnSync("node", [join(REPO, "scripts/gen-big-pdf.mjs"), probe], { stdio: "inherit" });
    if (r.status !== 0) fail("could not generate the probe PDF");
    pdfs = [probe, join(REPO, "app/e2e/fixtures/landscape-76.pdf"), join(REPO, "app/e2e/fixtures/book-76.pdf")];
  }
  const work = mkdtempSync(join(tmpdir(), "bookcomposer-perf-"));
  const library = new Map<string, Stages[]>();
  const dev = new Map<string, Stages[]>();
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    if (!options.skip.has("library")) {
      libraryRun(pdfs[0]!, work); // warm the file cache
      for (const pdf of pdfs) {
        const runs: Stages[] = [];
        for (let i = 0; i < options.runs; i++) runs.push(libraryRun(pdf, work));
        library.set(`${basename(pdf)} (${(statSync(pdf).size / 1e6).toFixed(1)} MB)`, runs);
        console.log(`library path: ${basename(pdf)} done`);
      }
    }
    if (!options.skip.has("dev")) {
      server = await startServer(options.port);
      const base = `http://127.0.0.1:${options.port}`;
      // SwiftShader: Chromium's default headless GL logs ReadPixels warnings (see playwright.config.ts).
      const browser = await chromium.launch({ args: ["--use-angle=swiftshader"] });
      try {
        await devRun(join(REPO, "app/e2e/fixtures/book-8.pdf"), base, server, browser, true); // warm-up: builds, optimizes and caches
        for (const pdf of pdfs) {
          const runs: Stages[] = [];
          for (let i = 0; i < options.runs; i++) runs.push(await devRun(pdf, base, server, browser, true));
          dev.set(`${basename(pdf)} (${(statSync(pdf).size / 1e6).toFixed(1)} MB)`, runs);
          console.log(`dev path: ${basename(pdf)} done`);
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    server?.stop();
    rmSync(work, { recursive: true, force: true });
  }
  const raw = (m: Map<string, Stages[]>) => Object.fromEntries([...m].map(([k, runs]) => [k, runs.map((r) => Object.fromEntries(r))]));
  writeFileSync(join(options.out, "results.json"), JSON.stringify({ library: raw(library), dev: raw(dev) }, null, 1));
  const text = [`Median of ${options.runs} runs, ms.`, "", table("Library path (CLI, no HTTP)", library), "", table("Dev path (browser, Vite, CLI)", dev)].join("\n");
  writeFileSync(join(options.out, "table.md"), text + "\n");
  console.log(`wrote ${join(options.out, "table.md")} and results.json`);
}

await main();
// Stray handles (the browser's pipes, say) must not keep a finished probe alive.
process.exit(0);
