// The fixed payloads behind the golden IPC frame fixtures in app/src-tauri/tests/data/. The Rust
// tests in app/src-tauri/src/commands.rs repeat these values; both sides must match the files.
// Regenerate the files with `make ipc-fixtures` after a deliberate wire format change.
import { fileURLToPath } from "node:url";

export const FIXTURE_DIR = fileURLToPath(new URL("../src-tauri/tests/data/", import.meta.url));
export const REQUEST_FILE = `${FIXTURE_DIR}export-request.bin`;
export const RESPONSE_FILE = `${FIXTURE_DIR}export-response.bin`;

/** The export_pdf request header, in the key order backend-tauri.ts sends. */
export const REQUEST_HEADER = { layout: '{"sheets":[]}', cutMarks: true, foldMarks: false };
export const REQUEST_PDF = new TextEncoder().encode("%PDF-1.7 source");

/** Multi-byte UTF-8 so the header's byte length differs from its string length. */
export const RESPONSE_WARNINGS = ["page 3 has annotations", "café 📖"];
export const RESPONSE_PDF = new TextEncoder().encode("%PDF-1.7 sheets");
