// Reading the first sheet of an .xlsx bank export into rows of text, synchronously, so the
// web worker and the server's re-read run the same code as for a CSV. An .xlsx is a zip of
// XML parts; we only need the shared strings, the cell styles (to spot dates) and sheet 1.
import { strFromU8, unzipSync } from "fflate";

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0]; // legacy .xls
const PDF = [0x25, 0x50, 0x44, 0x46]; // %PDF

const starts = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);
export const isZip = (b: Uint8Array) => starts(b, ZIP);
export const isLegacyXls = (b: Uint8Array) => starts(b, OLE);
export const isPdf = (b: Uint8Array) => starts(b, PDF);

/** Text with many control characters is a binary file (an image, a Numbers file...). */
export function looksBinary(b: Uint8Array): boolean {
  const n = Math.min(b.length, 4096);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) bad++;
  }
  return n > 0 && bad / n > 0.02;
}

const unescapeXml = (s: string) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, "&");

/** All the <t> text inside a fragment (rich text splits a string into runs). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join("");

/** Column letters of a cell reference to a 0-based index: "A1" -> 0, "AB7" -> 27. */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Built-in number formats that are dates or times. */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** For each cell style index, whether it shows a date. */
function dateStyles(stylesXml: string | undefined): boolean[] {
  if (!stylesXml) return [];
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), unescapeXml(m[2]));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  return [...xfs.matchAll(/<xf\s[^>]*?(?:\/>|>)/g)].map((m) => {
    const id = Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] ?? 0);
    if (DATE_FORMAT_IDS.has(id)) return true;
    const code = custom.get(id);
    // A custom format with day/month/year parts (ignoring quoted text and [colors]).
    return !!code && /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, ""));
  });
}

/** An Excel serial day (1900 system) as YYYY-MM-DD. */
export function serialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000); // 25569 = days from 1899-12-30 to 1970-01-01
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A number as Excel shows it, without float noise ("12.300000000000001" -> "12.3"). This only
 * tidies the file's text; amounts are parsed to cents later by parseCents.
 */
const numberText = (raw: string) => {
  const n = Number(raw);
  return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : raw;
};

/** Rows of the workbook's first sheet as text. Throws if it isn't a readable .xlsx. */
export function readXlsxRows(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes, {
    filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" || f.name === "xl/sharedStrings.xml"
      || f.name === "xl/styles.xml" || f.name.startsWith("xl/worksheets/sheet"),
  });
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : undefined);

  // The first sheet in workbook order, through its relationship id.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  const firstRid = workbook && /<sheet\s[^>]*r:id="([^"]+)"/.exec(workbook)?.[1];
  if (firstRid && rels) {
    const target = new RegExp(`<Relationship\\s[^>]*Id="${firstRid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
      ?? new RegExp(`<Relationship\\s[^>]*Target="([^"]+)"[^>]*Id="${firstRid}"`).exec(rels)?.[1];
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = read(sheetPath) ?? read("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("no sheet");

  const shared = (() => {
    const xml = read("xl/sharedStrings.xml");
    if (!xml) return [];
    return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  })();
  const isDateStyle = dateStyles(read("xl/styles.xml"));

  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const inner = c[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : row.length;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1);
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let text = "";
      if (type === "s" && v !== undefined) text = shared[Number(v)] ?? "";
      else if (type === "inlineStr") text = textOf(inner);
      else if (type === "str" || type === "e") text = v !== undefined ? unescapeXml(v) : "";
      else if (type === "b") text = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) text = isDateStyle[style] && Number(v) > 0 ? serialToIso(Number(v)) : numberText(v);
      while (row.length < col) row.push("");
      row[col] = text.trim();
    }
    rows.push(row);
  }
  return rows;
}
