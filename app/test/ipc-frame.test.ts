import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { frame, unframe } from "../src/lib/ipc-frame.ts";
import { REQUEST_FILE, REQUEST_HEADER, REQUEST_PDF, RESPONSE_FILE, RESPONSE_PDF, RESPONSE_WARNINGS } from "./ipc-fixtures.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const buffer = (data: Uint8Array) => data.slice().buffer;

test("frame then unframe gives back the JSON and the bytes", () => {
  const { json, rest } = unframe(buffer(frame({ a: [1, "two"] }, bytes("%PDF-1.7"))));
  assert.deepEqual(json, { a: [1, "two"] });
  assert.deepEqual(new Uint8Array(rest), bytes("%PDF-1.7"));
});

test("the length prefix counts UTF-8 bytes, not characters", () => {
  const warnings = ["café 📖"];
  const framed = frame(warnings, bytes("pdf"));
  const headerBytes = bytes(JSON.stringify(warnings)).length;
  assert.notEqual(headerBytes, JSON.stringify(warnings).length);
  assert.equal(new DataView(framed.buffer).getUint32(0), headerBytes);
  const { json, rest } = unframe(buffer(framed));
  assert.deepEqual(json, warnings);
  assert.deepEqual(new Uint8Array(rest), bytes("pdf"));
});

test("an empty warnings array round trips", () => {
  const { json, rest } = unframe(buffer(frame([], bytes("pdf"))));
  assert.deepEqual(json, []);
  assert.deepEqual(new Uint8Array(rest), bytes("pdf"));
});

test("an answer shorter than its length prefix is a clear error", () => {
  assert.throws(() => unframe(new ArrayBuffer(3)), { message: "framed answer is shorter than its length prefix" });
});

test("an answer shorter than its header length is a clear error", () => {
  const framed = frame(["warning"], new Uint8Array());
  assert.throws(() => unframe(buffer(framed.subarray(0, framed.length - 1))), {
    message: "framed answer is shorter than its header length",
  });
});

test("the export request frames byte-equal the golden fixture the Rust side reads", () => {
  assert.deepEqual(frame(REQUEST_HEADER, REQUEST_PDF), new Uint8Array(readFileSync(REQUEST_FILE)));
});

test("the golden export answer the Rust side writes unframes to its warnings and PDF", () => {
  const { json, rest } = unframe(buffer(new Uint8Array(readFileSync(RESPONSE_FILE))));
  assert.deepEqual(json, RESPONSE_WARNINGS);
  assert.deepEqual(new Uint8Array(rest), RESPONSE_PDF);
});
