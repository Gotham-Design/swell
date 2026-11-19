// Turns a raw bank description into a readable one (description_clean) and a stable key
// for the merchant (vendor_normalized), so "SQ *BLUE BOTTLE COFFEE Oakland CA" and
// "SQ*BLUE BOTTLE COFFEE" both become vendor "blue bottle coffee". Used on every save and
// by the importer. Deterministic: same input, same output.

import { findMerchant } from "./merchants";
export interface Normalized {
  description_clean: string;
  vendor_normalized: string | null;
}

// Leading bank boilerplate ("POS PURCHASE", "CHECKCARD 1012", ...).
const BANK_PREFIX = new RegExp(
  "^(?:" + [
    "POS (?:PURCHASE|DEBIT|WITHDRAWAL)",
    "DEBIT CARD PURCHASE",
    "CHECKCARD(?: \\d{4})?",
    "(?:RECURRING PAYMENT |PURCHASE |PURCHASE RETURN |RECURRING PURCHASE |MONEY TRANSFER )?AUTHORIZED ON(?: \\d{1,2}/\\d{1,2})?(?: FROM| TO)?",
    "BUSINESS TO BUSINESS ACH (?:DEBIT|CREDIT)(?: -)?",
    "ACH (?:DEBIT|CREDIT)",
    "RECURRING (?:PAYMENT|PURCHASE)",
    "VISA DDA PUR",
  ].join("|") + ")\\s+",
);
// Payment processors that front the real merchant: Square, Toast, PayPal, Shopify, ...
const PROCESSOR_PREFIX = /^(?:SQ|TST|PAYPAL|PP|SP|PY|IC)\s?\*\s?/;

const US_STATES = new Set((
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA " +
  "RI SC SD TN TX UT VT VA WA WV WI WY DC"
).split(" "));
// First words of multi-word city names ("SAN FRANCISCO", "LOS GATOS", "NEW YORK").
const CITY_PREFIX = new Set(["SAN", "SANTA", "LOS", "LAS", "NEW", "ST", "SAINT", "FORT", "FT", "EL", "PALO", "SALT", "LAKE", "WEST", "EAST", "NORTH", "SOUTH"]);
const NOISE_WORDS = new Set(["PENDING", "USA", "US"]);
const CORP_SUFFIX = new Set(["INC", "LLC", "CORP", "LTD", "CO"]);

// Different spellings of one merchant. Matched on the cleaned, upper-case text.

const isDomain = (t: string) => /^[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.(?:COM|NET|ORG|IO|CO|APP|AI)(?:\/\S*)?$/.test(t);
const stripTld = (t: string) => t.replace(/\.(?:COM|NET|ORG|IO|CO|APP|AI)(?:\/\S*)?$/, "");

/** Tokens that identify a store, card, order or terminal rather than the merchant. */
function isNoiseToken(t: string): boolean {
  if (t.startsWith("#")) return true;                          // #1234
  if (/^\d{3,}$/.test(t)) return true;                         // 57444, 0123
  if (/^X{2,}\d{2,}$/.test(t)) return true;                    // XXXX1234
  if (/^[A-Z]-?\d{3,}$/.test(t)) return true;                  // T-1234, F12345
  if (t.length >= 6 && (t.match(/\d/g)?.length ?? 0) >= 3) return true; // 2K4LM8Q90
  return NOISE_WORDS.has(t);
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

export function normalizeDescription(raw: string): Normalized {
  const original = raw.replace(/\s+/g, " ").trim();
  let s = original.toUpperCase();

  for (let prev = ""; prev !== s;) {
    prev = s;
    s = s.replace(BANK_PREFIX, "").replace(PROCESSOR_PREFIX, "").trim();
  }

  // Wells Fargo-style ACH and card lines: "COMPANY ENTRY 260911 0123456789 PERSON NAME" or
  // "MERCHANT CITY ST S100000000000001 CARD 1111". The merchant ends at the first YYMMDD date
  // or long reference code (after at least two words), or at "REF #...".
  {
    const words = s.split(" ");
    const cut = words.findIndex((w, i) => i >= 2 && (
      (/^\d{6}$/.test(w) && Number(w.slice(2, 4)) >= 1 && Number(w.slice(2, 4)) <= 12)
      || (w.length >= 8 && (w.match(/\d/g)?.length ?? 0) >= 4 && !w.includes("."))
      || (w === "REF" && (words[i + 1] ?? "").startsWith("#"))));
    if (cut > 0) s = words.slice(0, cut).join(" ");
  }

  // Whole-string noise: phone numbers, dates, "STORE 123", "CARD 1234".
  s = s.replace(/\b1?-?\d{3}-\d{3}-\d{4}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/\bSTORE\s*#?\d+\b/g, " ")
    .replace(/\bCARD\s+X*\d{4}\b/g, " ")
    .replace(/\s+/g, " ").trim();

  // "VENDOR *DETAIL": the part before the first * names the merchant.
  const [vendorRaw, ...rest] = s.split("*");
  const detail = rest.join(" ");

  const clean = (part: string, first: boolean) => {
    let tokens = part.split(" ").map((t) => t.replace(/[,;:]+$/, "")).filter(Boolean);
    tokens = tokens.flatMap((t, i) => {
      if (isDomain(t)) return first && i === 0 ? [stripTld(t)] : [];
      // After the *, letter-and-digit codes are order or reference numbers (3QXWLK).
      if (!first && /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{5,}$/.test(t)) return [];
      return isNoiseToken(t) ? [] : [t];
    });
    return tokens;
  };

  let vendorTokens = clean(vendorRaw, true);
  let detailTokens = clean(detail, false);

  // Trailing "CITY ST" belongs to whichever part ends the description. After a *, an
  // online merchant usually gives only a state, so the city is dropped only before one.
  const dropPlace = (tokens: string[], withCity: boolean) => {
    const out = [...tokens];
    // A detail can be just the state ("DROPBOX*3QXWLK DROPBOX.COM CA"); a vendor keeps one word.
    if (out.length >= (withCity ? 2 : 1) && US_STATES.has(out[out.length - 1])) {
      out.pop();
      if (withCity && out.length >= 2 && /^[A-Z.'-]+$/.test(out[out.length - 1])) {
        out.pop();
        while (out.length >= 2 && CITY_PREFIX.has(out[out.length - 1])) out.pop();
      }
    }
    return out;
  };
  if (detailTokens.length) detailTokens = dropPlace(detailTokens, false);
  else vendorTokens = dropPlace(vendorTokens, true);

  const dropSuffix = (tokens: string[]) => (tokens.length >= 2 && CORP_SUFFIX.has(tokens[tokens.length - 1]) ? tokens.slice(0, -1) : tokens);
  vendorTokens = dropSuffix(vendorTokens);
  detailTokens = dropSuffix(detailTokens);

  const vendorText = vendorTokens.join(" ");
  const fullText = [...vendorTokens, ...detailTokens].join(" ");

  if (!fullText) return { description_clean: original, vendor_normalized: null };

  const known = findMerchant(fullText) ?? findMerchant(s);
  if (known?.rename) return { description_clean: known.name, vendor_normalized: known.vendor };

  // A detail that only repeats the vendor ("DROPBOX*3QXWLK DROPBOX.COM") adds nothing.
  const detailText = detailTokens.join(" ");
  const description = detailText && detailText !== vendorText ? `${vendorText} ${detailText}` : vendorText;

  const vendor = vendorText.toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ").trim();

  // A well-known merchant gets one vendor key, whatever reference numbers the bank added
  // ("STATE FARM RO 27 CPC-CLIENT"), and its own name when the rest is just codes.
  if (known) {
    return { description_clean: /\d/.test(description) ? known.name : titleCase(description), vendor_normalized: known.vendor };
  }
  return { description_clean: titleCase(description), vendor_normalized: vendor || null };
}
