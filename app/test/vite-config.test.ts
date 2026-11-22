import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createLogger, createServer, type Logger } from "vite";

const app = fileURLToPath(new URL("..", import.meta.url));
const repo = fileURLToPath(new URL("../..", import.meta.url));

test("the dev server serves the engine sources but nothing else outside the app", async () => {
  // Denials are logged; capture them so they are checked here instead of printed.
  const logged: string[] = [];
  const logger: Logger = {
    ...createLogger("silent"),
    info: () => {},
    warn: (message) => logged.push(message),
    warnOnce: (message) => logged.push(message),
    error: (message) => logged.push(message),
  };
  const server = await createServer({
    root: app,
    configFile: `${app}vite.config.ts`,
    customLogger: logger,
    server: { port: 0, strictPort: false },
  });
  try {
    await server.listen();
    const base = server.resolvedUrls!.local[0]!.replace(/\/$/, "");
    const status = async (path: string) => (await fetch(`${base}/@fs${repo}${path}`)).status;
    assert.equal(await status("engine/src/index.ts"), 200);
    assert.equal(await status("Makefile"), 403);
    assert.equal(await status("engine/package.json"), 403);
    assert.deepEqual(logged.filter((m) => m.startsWith("The request id")), [
      `The request id "${repo}Makefile" is outside of Vite serving allow list.`,
      `The request id "${repo}engine/package.json" is outside of Vite serving allow list.`,
    ]);
    // Each denial also lists the allowed directories: the app and the engine sources only.
    const hint = `\n- ${app.replace(/\/$/, "")}\n- ${repo}engine/src\n\nRefer to docs https://vite.dev/config/server-options.html#server-fs-allow for configurations and more details.\n`;
    assert.deepEqual(logged.filter((m) => !m.startsWith("The request id")), [hint, hint]);
  } finally {
    await server.close();
  }
});
