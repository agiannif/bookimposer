import { test } from "node:test";
import assert from "node:assert/strict";
// Node cannot use the Vite alias, so tests import the engine by relative path.
import { impose } from "../../engine/src/index.ts";
import { workedExample } from "../../engine/test/fixtures.ts";

test("the engine imposes the worked example into 11 sheets", () => {
  assert.equal(impose(workedExample()).sheets.length, 11);
});
