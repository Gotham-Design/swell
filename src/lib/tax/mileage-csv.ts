// Reads a mileage log export (MileIQ, Everlance, TripLog, a spreadsheet of your own) into
// trips. Pure: no I/O. Rows marked Personal are left out.
import Papa from "papaparse";
import { detectDateFormat, parseDate } from "@/lib/import/dates";
import { parseMiles } from "./miles";

export interface ParsedTrip {
  date: string;
  miles_tenths: number;
  purpose: string;
  start_place: string | null;
  end_place: string | null;
  vehicle: string | null;
}
export interface MileageParse { trips: ParsedTrip[]; skipped: number; personal: number; error?: string }

const norm = (h: string) => h.toLowerCase().replace(/[*_]/g, " ").replace(/\s+/g, " ").trim();
const find = (headers: string[], ...names: RegExp[]) => {
  for (const re of names) {
    const i = headers.findIndex((h) => re.test(h));
    if (i >= 0) return i;
  }
  return -1;
};

export function parseMileageCsv(text: string): MileageParse {
  const rows = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" }).data;
  const headerAt = rows.findIndex((r) => r.some((c) => /mile|distance/i.test(c)) && r.some((c) => /date/i.test(c)));
  if (headerAt < 0) return { trips: [], skipped: 0, personal: 0, error: "Couldn't find Date and Miles columns in that file." };
  const headers = rows[headerAt].map(norm);
  const col = {
    date: find(headers, /^date$/, /^start date/, /^trip date/, /date/),
    miles: find(headers, /^miles$/, /^business miles/, /^distance/, /^mileage/, /mile/),
    purpose: find(headers, /^purpose/, /^description/, /^reason/, /^notes?$/, /^memo/, /^client/),
    category: find(headers, /^category/, /^type$/, /^classification/),
    start: find(headers, /^start$/, /^from/, /^origin/, /^start (location|address|place)/),
    end: find(headers, /^stop$/, /^end$/, /^to$/, /^destination/, /^end (location|address|place)/),
    vehicle: find(headers, /^vehicle/, /^car$/),
  };
  if (col.date < 0 || col.miles < 0) return { trips: [], skipped: 0, personal: 0, error: "Couldn't find Date and Miles columns in that file." };
  const body = rows.slice(headerAt + 1);
  const dates = body.map((r) => (r[col.date] ?? "").trim()).filter(Boolean);
  const format = detectDateFormat(dates.slice(0, 200)).format;
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const trips: ParsedTrip[] = [];
  let skipped = 0;
  let personal = 0;
  for (const r of body) {
    if (/personal/i.test(cell(r, col.category))) { personal++; continue; }
    const date = format ? parseDate(cell(r, col.date), format) : null;
    const miles = parseMiles(cell(r, col.miles));
    if (!date || miles === null) { skipped++; continue; }
    const purpose = cell(r, col.purpose) || cell(r, col.category) || "Business trip";
    trips.push({
      date, miles_tenths: miles, purpose: purpose.slice(0, 200),
      start_place: cell(r, col.start).slice(0, 200) || null, end_place: cell(r, col.end).slice(0, 200) || null,
      vehicle: cell(r, col.vehicle).slice(0, 80) || null,
    });
  }
  return { trips, skipped, personal };
}
