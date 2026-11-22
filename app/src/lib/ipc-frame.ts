// The frame the Tauri export_pdf command reads and answers with (see backend-tauri.ts and
// app/src-tauri/src/commands.rs): a 4-byte big-endian byte length N, N bytes of UTF-8 JSON, then
// raw bytes to the end. Golden fixtures in app/src-tauri/tests/data/ keep both sides in step.

/** `json` as UTF-8, behind its 4-byte big-endian byte length, then `rest`. */
export function frame(json: unknown, rest: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify(json));
  const body = new Uint8Array(4 + header.length + rest.length);
  new DataView(body.buffer).setUint32(0, header.length);
  body.set(header, 4);
  body.set(rest, 4 + header.length);
  return body;
}

/** The JSON and the bytes after it in a framed answer. */
export function unframe(body: ArrayBuffer): { json: unknown; rest: ArrayBuffer } {
  if (body.byteLength < 4) throw new Error("framed answer is shorter than its length prefix");
  const length = new DataView(body).getUint32(0);
  if (body.byteLength - 4 < length) throw new Error("framed answer is shorter than its header length");
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(body, 4, length)));
  return { json, rest: body.slice(4 + length) };
}
