import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { impose } from "../../engine/src/index.ts";
import { DEFAULT_SETTINGS, toBookSpec } from "../src/lib/book.ts";
import { createExporterHandler, jsonHeader } from "../dev/exporter-middleware.ts";

const pdf = await readFile(new URL("../e2e/fixtures/book-8.pdf", import.meta.url));
const pages = Array.from({ length: 8 }, () => ({ width: 288, height: 378 }));
const layout = impose(toBookSpec(pages, DEFAULT_SETTINGS));

const servers: Server[] = [];
async function serve(options?: Parameters<typeof createExporterHandler>[0]): Promise<string> {
  const handler = createExporterHandler(options);
  const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end("next"); }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

let base: string;
before(async () => { base = await serve(); });
after(() => { for (const s of servers) s.close(); });

function exportForm(layoutText: string): FormData {
  const form = new FormData();
  form.set("pdf", new Blob([pdf]), "book.pdf");
  form.set("layout", layoutText);
  form.set("cutMarks", "true");
  form.set("foldMarks", "false");
  return form;
}

test("page-sizes returns 8 entries of the fixture size", async () => {
  const res = await fetch(`${base}/__dev/page-sizes`, { method: "POST", body: pdf });
  assert.equal(res.status, 200);
  const json = await res.json() as { pageSizes: unknown[]; boxes: unknown[] };
  assert.deepEqual(json.pageSizes, pages);
  assert.equal(json.boxes.length, 8);
});

test("export of a 1-signature layout returns a PDF and a warnings header", async () => {
  const res = await fetch(`${base}/__dev/export`, { method: "POST", body: exportForm(JSON.stringify(layout)) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.ok(Array.isArray(JSON.parse(res.headers.get("x-export-warnings")!)));
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "%PDF");
});

test("a broken layout gives 422 with the CLI message", async () => {
  const res = await fetch(`${base}/__dev/export`, { method: "POST", body: exportForm("{}") });
  assert.equal(res.status, 422);
  const { error } = await res.json() as { error: string };
  assert.match(error, /layout/i);
});

test("a missing PDFium dir gives 422 pointing at make fetch-pdfium", async () => {
  const url = await serve({ pdfiumDir: "/nonexistent/pdfium" });
  const res = await fetch(`${url}/__dev/page-sizes`, { method: "POST", body: pdf });
  assert.equal(res.status, 422);
  const { error } = await res.json() as { error: string };
  assert.match(error, /PDFium not found/);
  assert.match(error, /make fetch-pdfium/);
});

test("BOOKCOMPOSER_DEV_EXPORT_FAIL forces an export failure", async () => {
  const url = await serve({ forceExportFailure: true });
  const res = await fetch(`${url}/__dev/export`, { method: "POST", body: exportForm(JSON.stringify(layout)) });
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { error: "forced failure (BOOKCOMPOSER_DEV_EXPORT_FAIL)" });
});

test("other URLs fall through to next", async () => {
  const res = await fetch(`${base}/index.html`);
  assert.equal(await res.text(), "next");
});

async function errorOf(res: Response, status: number): Promise<string> {
  assert.equal(res.status, status);
  const { error } = await res.json() as { error: string };
  assert.equal(typeof error, "string");
  return error;
}

test("a non-multipart export body gives 400", async () => {
  const res = await fetch(`${base}/__dev/export`, { method: "POST", body: "nope", headers: { "content-type": "text/plain" } });
  assert.match(await errorOf(res, 400), /multipart/i);
});

test("an export without a layout field gives 400 naming layout", async () => {
  const form = new FormData();
  form.set("pdf", new Blob([pdf]), "book.pdf");
  form.set("cutMarks", "false");
  form.set("foldMarks", "false");
  const res = await fetch(`${base}/__dev/export`, { method: "POST", body: form });
  assert.match(await errorOf(res, 400), /layout/);
});

test("an export with layout that is not JSON gives 400, and the server keeps working", async () => {
  const bad = await fetch(`${base}/__dev/export`, { method: "POST", body: exportForm("{not json") });
  assert.match(await errorOf(bad, 400), /layout/);
  const good = await fetch(`${base}/__dev/export`, { method: "POST", body: exportForm(JSON.stringify(layout)) });
  assert.equal(good.status, 200);
});

test("an unexpected failure gives 500 and is logged once", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const url = await serve({ repoRoot: "/nonexistent-repo", pdfiumDir: new URL("../../vendor/pdfium/lib", import.meta.url).pathname });
  const res = await fetch(`${url}/__dev/page-sizes`, { method: "POST", body: pdf });
  await errorOf(res, 500);
  assert.equal(log.mock.callCount(), 1);
});

test("a failed build is retried by the next request", async (t) => {
  t.mock.method(console, "error", () => {});
  const root = await mkdtemp(join(tmpdir(), "bookcomposer-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // A stand-in cargo that fails on its first run, then "builds" by copying the real binary.
  const realBin = new URL("../../target/release/bookcomposer-export", import.meta.url).pathname;
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin/cargo"), [
    "#!/bin/sh",
    `echo run >> "${root}/attempts"`,
    `[ "$(wc -l < "${root}/attempts")" -ge 2 ] || { echo 'compile error' >&2; exit 1; }`,
    `mkdir -p target/release && cp "${realBin}" target/release/bookcomposer-export`,
  ].join("\n"));
  await chmod(join(root, "bin/cargo"), 0o755);
  await mkdir(join(root, "repo"));
  const url = await serve({ repoRoot: join(root, "repo"), rustupBin: join(root, "bin"), pdfiumDir: new URL("../../vendor/pdfium/lib", import.meta.url).pathname });
  const first = await fetch(`${url}/__dev/page-sizes`, { method: "POST", body: pdf });
  assert.match(await errorOf(first, 500), /compile error/);
  const second = await fetch(`${url}/__dev/page-sizes`, { method: "POST", body: pdf });
  assert.equal(second.status, 200);
  assert.equal((await readFile(join(root, "attempts"), "utf8")).trim().split("\n").length, 2);
});

test("a temp dir that cannot be created gives 500 and the server stays up", async (t) => {
  t.mock.method(console, "error", () => {});
  const file = join(await mkdtemp(join(tmpdir(), "bookcomposer-test-")), "not-a-dir");
  t.after(() => rm(dirname(file), { recursive: true, force: true }));
  await writeFile(file, "");
  const url = await serve({ tmpRoot: file });
  await errorOf(await fetch(`${url}/__dev/page-sizes`, { method: "POST", body: pdf }), 500);
  await errorOf(await fetch(`${url}/__dev/page-sizes`, { method: "POST", body: pdf }), 500);
});

test("warnings with non-ASCII text survive the header encoding", () => {
  const warnings = ["page é → cropped"];
  const header = jsonHeader(warnings);
  assert.match(header, /^[\x20-\x7e]*$/);
  assert.deepEqual(JSON.parse(header), warnings);
});

test("a CLI error names the file without the server's temp path", async () => {
  const res = await fetch(`${base}/__dev/page-sizes`, { method: "POST", body: "not a pdf" });
  const error = await errorOf(res, 422);
  assert.equal(error, "input.pdf: not a PDF or the file is damaged");
});

test("a request from another origin is refused with 403", async () => {
  const res = await fetch(`${base}/__dev/page-sizes`, { method: "POST", body: pdf, headers: { origin: "http://evil.example" } });
  assert.match(await errorOf(res, 403), /origin/i);
});

test("a request from the server's own origin is served", async () => {
  const res = await fetch(`${base}/__dev/page-sizes`, { method: "POST", body: pdf, headers: { origin: base } });
  assert.equal(res.status, 200);
});

/** A repo whose cargo does nothing and whose export binary is `script`, to drive the CLI limits. */
async function fakeExporter(t: { after(fn: () => unknown): void }, script: string[]): Promise<{ repoRoot: string; rustupBin: string; pdfiumDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "bookcomposer-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin/cargo"), "#!/bin/sh\n");
  await chmod(join(root, "bin/cargo"), 0o755);
  await mkdir(join(root, "repo/target/release"), { recursive: true });
  await writeFile(join(root, "repo/target/release/bookcomposer-export"), ["#!/bin/sh", ...script].join("\n"));
  await chmod(join(root, "repo/target/release/bookcomposer-export"), 0o755);
  return { repoRoot: join(root, "repo"), rustupBin: join(root, "bin"), pdfiumDir: new URL("../../vendor/pdfium/lib", import.meta.url).pathname };
}

test("a CLI run that takes too long is stopped with a 422", async (t) => {
  const url = await serve({ ...(await fakeExporter(t, ["exec sleep 5"])), cliLimits: { timeoutMs: 200, maxBufferBytes: 1024 } });
  const started = Date.now();
  const res = await fetch(`${url}/__dev/page-sizes`, { method: "POST", body: pdf });
  assert.equal(await errorOf(res, 422), "The exporter took longer than 0.2 s and was stopped");
  assert.ok(Date.now() - started < 3000);
});

test("a CLI run with more output than the buffer allows is stopped with a 422", async (t) => {
  const url = await serve({ ...(await fakeExporter(t, ["head -c 4096 /dev/zero"])), cliLimits: { timeoutMs: 5000, maxBufferBytes: 1024 } });
  const res = await fetch(`${url}/__dev/page-sizes`, { method: "POST", body: pdf });
  assert.equal(await errorOf(res, 422), "The exporter wrote more than 1024 bytes of output and was stopped");
});

test("with BOOKCOMPOSER_TIMINGS the stage lines go to stderr and are not export warnings", async (t) => {
  const lines: string[] = [];
  t.mock.method(console, "error", (line: string) => lines.push(line));
  process.env.BOOKCOMPOSER_TIMINGS = "1";
  t.after(() => delete process.env.BOOKCOMPOSER_TIMINGS);
  // The CLI inherits the variable from the server's environment at the time the handler is made.
  const timed = await serve();
  const res = await fetch(`${timed}/__dev/export`, { method: "POST", body: exportForm(JSON.stringify(layout)) });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.headers.get("x-export-warnings")!), []);
  const stages = lines.map((line) => JSON.parse(line) as { stage: string; request: number; from?: string });
  assert.ok(stages.some((s) => s.stage === "mw:cli" && s.from === undefined), "middleware stage");
  assert.ok(stages.some((s) => s.stage === "export.total" && s.from === "cli"), "relayed CLI stage");
  assert.equal(new Set(stages.map((s) => s.request)).size, 1);
});
