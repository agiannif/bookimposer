// Dev-only endpoints that run the bookcomposer-export CLI for the browser app:
//   POST /__dev/page-sizes  body: PDF bytes -> the CLI's page-sizes JSON
//   POST /__dev/export      multipart: pdf (file), layout (JSON text), cutMarks, foldMarks
//                           -> PDF bytes, warnings as a JSON array in X-Export-Warnings
// Every failure answers with { error }: 422 when the CLI rejects the work, 400 for a bad request,
// 500 (logged) for anything unexpected, 403 for a request from another origin. Errors name files
// without the server's temp dir. The Tauri app does not use this.
import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { access, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export interface ExporterOptions {
  repoRoot?: string;
  /** Defaults to $RUSTUP_BIN, then the Makefile's default. */
  rustupBin?: string;
  /** Defaults to $BOOKCOMPOSER_PDFIUM_DIR, then <repo>/vendor/pdfium/lib. */
  pdfiumDir?: string;
  /** Defaults to whether BOOKCOMPOSER_DEV_EXPORT_FAIL is set. Test hook for the e2e suite. */
  forceExportFailure?: boolean;
  /** Where per-request temp dirs go. Defaults to the OS temp dir. */
  tmpRoot?: string;
  /** How long a CLI run may take and how much it may print. Defaults to 120 s and 64 MiB. */
  cliLimits?: { timeoutMs: number; maxBufferBytes: number };
}

/** JSON that is safe in an HTTP header: non-ASCII characters are escaped, so JSON.parse still restores them. */
export function jsonHeader(value: unknown): string {
  return JSON.stringify(value).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** An answer the caller should see: 422 when the CLI or PDFium setup rejects the work, 400 for a bad request. */
class RequestError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

const pdfiumLibrary = process.platform === "darwin" ? "libpdfium.dylib" : "libpdfium.so";

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string") throw new RequestError(`export request is missing the ${name} field`, 400);
  return value;
}

export function createExporterHandler(options: ExporterOptions = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const rustupBin = options.rustupBin ?? process.env.RUSTUP_BIN ?? "/home/linuxbrew/.linuxbrew/opt/rustup/bin";
  const pdfiumDir = options.pdfiumDir ?? process.env.BOOKCOMPOSER_PDFIUM_DIR ?? join(repoRoot, "vendor/pdfium/lib");
  const forceExportFailure = options.forceExportFailure ?? Boolean(process.env.BOOKCOMPOSER_DEV_EXPORT_FAIL);
  const exportBin = join(repoRoot, "target/release/bookcomposer-export");
  const env = { ...process.env, PATH: `${rustupBin}:${process.env.PATH ?? ""}`, BOOKCOMPOSER_PDFIUM_DIR: pdfiumDir };
  const { timeoutMs, maxBufferBytes } = options.cliLimits ?? { timeoutMs: 120_000, maxBufferBytes: 64 * 1024 * 1024 };

  // One build per handler, started by the first request that needs it.
  let build: Promise<unknown> | undefined;
  // A failed build is forgotten so the next request tries again.
  const ensureBuilt = () =>
    (build ??= run("cargo", ["build", "--release", "-p", "pdf-export", "--quiet"], { cwd: repoRoot, env }).catch((e) => {
      build = undefined;
      throw e;
    }));

  /** Runs the export CLI on files in `dir`, whose path is left out of its error messages. */
  async function cli(args: string[], dir: string): Promise<{ stdout: string; stderr: string }> {
    try {
      await access(join(pdfiumDir, pdfiumLibrary));
    } catch {
      throw new RequestError(`PDFium not found in ${pdfiumDir}. Run 'make fetch-pdfium' first.`);
    }
    try {
      await ensureBuilt();
    } catch (e) {
      throw new Error(`cargo build failed: ${(e as { stderr?: string }).stderr ?? e}`);
    }
    try {
      return await run(exportBin, args, { env, timeout: timeoutMs, maxBuffer: maxBufferBytes });
    } catch (e) {
      const { stderr, code, killed } = e as { stderr?: string; code?: unknown; killed?: boolean };
      if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        throw new RequestError(`The exporter wrote more than ${maxBufferBytes} bytes of output and was stopped`);
      }
      if (killed) throw new RequestError(`The exporter took longer than ${timeoutMs / 1000} s and was stopped`);
      throw new RequestError((stderr?.trim() || String(e)).replaceAll(join(dir, "/"), ""));
    }
  }

  async function pageSizes(req: IncomingMessage, res: ServerResponse, dir: string): Promise<void> {
    const input = join(dir, "input.pdf");
    await writeFile(input, await readBody(req));
    const { stdout } = await cli(["page-sizes", input], dir);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(stdout);
  }

  async function exportPdf(req: IncomingMessage, res: ServerResponse, dir: string): Promise<void> {
    if (forceExportFailure) throw new RequestError("forced failure (BOOKCOMPOSER_DEV_EXPORT_FAIL)");
    const host = req.headers.host ?? "localhost";
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    let form: FormData;
    try {
      form = await new Request(`http://${host}/`, { method: "POST", headers, body: req as never, duplex: "half" } as RequestInit).formData();
    } catch (e) {
      throw new RequestError(`export request must be multipart/form-data: ${(e as Error).message}`, 400);
    }
    const pdf = form.get("pdf");
    if (!(pdf instanceof Blob)) throw new RequestError("export request is missing the pdf field", 400);
    const input = join(dir, "input.pdf");
    const layout = join(dir, "layout.json");
    const output = join(dir, "output.pdf");
    await writeFile(input, Buffer.from(await pdf.arrayBuffer()));
    const layoutText = textField(form, "layout");
    try {
      JSON.parse(layoutText);
    } catch {
      throw new RequestError("export request layout field is not valid JSON", 400);
    }
    await writeFile(layout, layoutText);
    const args = ["export", "--layout", layout, "--input", input, "--output", output];
    if (textField(form, "cutMarks") === "true") args.push("--cut-marks");
    if (textField(form, "foldMarks") === "true") args.push("--fold-marks");
    const { stderr } = await cli(args, dir);
    const warnings = stderr.split("\n").filter((line) => line.trim() !== "");
    res.writeHead(200, { "content-type": "application/pdf", "x-export-warnings": jsonHeader(warnings) });
    res.end(await readFile(output));
  }

  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const path = (req.url ?? "").split("?")[0];
    const action = req.method === "POST" ? { "/__dev/page-sizes": pageSizes, "/__dev/export": exportPdf }[path] : undefined;
    if (!action) return next();
    // Only the app's own pages may use these endpoints; a page on another site could otherwise post here.
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${req.headers.host}`) {
      sendJson(res, 403, { error: `Requests from another origin (${origin}) are refused` });
      return;
    }
    let dir: string | undefined;
    try {
      dir = await mkdtemp(join(options.tmpRoot ?? tmpdir(), "bookcomposer-"));
      await action(req, res, dir);
    } catch (e) {
      const status = e instanceof RequestError ? e.status : 500;
      if (status === 500) console.error(`[bookcomposer-dev-exporter] ${path} failed:`, e);
      if (res.headersSent) res.destroy();
      else sendJson(res, status, { error: (e as Error).message });
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  };
}
