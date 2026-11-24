// Stage timing for `make perf-probe`: User Timing measures named "bc:<stage>", which the probe reads through
// Playwright. Off unless the page sets `globalThis.__bookimposerPerf = true` before the app loads, so normal
// runs record nothing.

const enabled = () => (globalThis as { __bookimposerPerf?: unknown }).__bookimposerPerf === true;

/** Records the time since `start` (a `performance.now()` reading) as the stage `name`. */
export function record(name: string, start: number, detail?: Record<string, unknown>): void {
  if (enabled()) performance.measure(`bc:${name}`, { start, end: performance.now(), detail });
}

/** Records a duration measured elsewhere (a worker, say) as a stage that just ended. */
export function recordDuration(name: string, ms: number, detail?: Record<string, unknown>): void {
  if (enabled()) performance.measure(`bc:${name}`, { start: performance.now() - ms, duration: ms, detail });
}

/** Runs `fn` and records how long it took, until it settles when it returns a promise. */
export async function timed<T>(name: string, fn: () => T | Promise<T>, detail?: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(name, start, detail);
  }
}

/** Like `timed` for a function that returns at once. */
export function timedSync<T>(name: string, fn: () => T, detail?: Record<string, unknown>): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    record(name, start, detail);
  }
}
