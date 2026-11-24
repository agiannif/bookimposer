// Writes a book PDF with large shared images, for `make perf-probe`: PAGES pages of 288x378 pt (TrimBox
// inset 9 pt, BleedBox = media), each drawing one of 20 noisy RGB images and a page-number label. The
// default 300 pages at 1100 px come to about 88 MB, the size of a typeset book with many photos.
// Usage: node scripts/gen-big-pdf.mjs out.pdf [pages=300] [imagePx=1100]
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const [out, pagesArg = "300", pxArg = "1100"] = process.argv.slice(2);
const N = Number(pagesArg), PX = Number(pxArg);
if (!out || !Number.isInteger(N) || N < 1 || !Number.isInteger(PX) || PX < 1) {
  console.error("Usage: node scripts/gen-big-pdf.mjs out.pdf [pages=300] [imagePx=1100]");
  process.exit(2);
}
const IMAGES = 20;
const objs = [];
const add = (body) => { objs.push(body); return objs.length; };

function image(seed) {
  const w = PX, h = Math.round(PX * 378 / 288);
  const raw = Buffer.alloc(w * h * 3);
  let s = seed * 9301 + 49297;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const i = (y * w + x) * 3;
    raw[i] = (x * 255 / w + (s & 63)) & 255; raw[i + 1] = (y * 255 / h + ((s >> 6) & 63)) & 255; raw[i + 2] = (seed * 40 + ((s >> 12) & 63)) & 255;
  }
  const data = deflateSync(raw, { level: 1 });
  return add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`), data, Buffer.from("\nendstream")]));
}
const font = add(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
const imgs = Array.from({ length: IMAGES }, (_, i) => image(i));
const pageIds = [];
const contentIds = [];
for (let p = 0; p < N; p++) {
  const c = `q 288 0 0 378 0 0 cm /Im Do Q BT /F 60 Tf 40 160 Td (${p + 1}) Tj ET`;
  contentIds.push(add(Buffer.from(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`)));
}
const pagesObj = objs.length + N + 1;
for (let p = 0; p < N; p++) {
  pageIds.push(add(Buffer.from(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 288 378] /TrimBox [9 9 279 369] /BleedBox [0 0 288 378] /Contents ${contentIds[p]} 0 R /Resources << /Font << /F ${font} 0 R >> /XObject << /Im ${imgs[p % IMAGES]} 0 R >> >> >>`)));
}
add(Buffer.from(`<< /Type /Pages /Count ${N} /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] >>`));
const catalog = add(Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`));

const parts = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
const offsets = [];
let pos = parts[0].length;
objs.forEach((body, i) => {
  offsets.push(pos);
  const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
  parts.push(b); pos += b.length;
});
const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
writeFileSync(out, Buffer.concat(parts));
console.log(`${out}: ${N} pages, ${(pos / 1e6).toFixed(1)} MB`);
