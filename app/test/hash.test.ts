import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "../src/lib/hash.ts";

test("sha256Hex of empty input is the known digest", async () => {
  assert.equal(await sha256Hex(new ArrayBuffer(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("sha256Hex of abc is the known digest, lowercase hex", async () => {
  const bytes = new TextEncoder().encode("abc");
  assert.equal(await sha256Hex(bytes.buffer as ArrayBuffer), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
