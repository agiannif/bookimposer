// Writes the golden IPC frame fixtures from the payloads in ipc-fixtures.ts. Run via `make ipc-fixtures`.
import { writeFileSync } from "node:fs";
import { frame } from "../src/lib/ipc-frame.ts";
import { REQUEST_FILE, REQUEST_HEADER, REQUEST_PDF, RESPONSE_FILE, RESPONSE_PDF, RESPONSE_WARNINGS } from "./ipc-fixtures.ts";

writeFileSync(REQUEST_FILE, frame(REQUEST_HEADER, REQUEST_PDF));
writeFileSync(RESPONSE_FILE, frame(RESPONSE_WARNINGS, RESPONSE_PDF));
console.log(`wrote ${REQUEST_FILE} and ${RESPONSE_FILE}`);
