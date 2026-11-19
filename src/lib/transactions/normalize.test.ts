import { describe, expect, it } from "vitest";
import { normalizeDescription } from "./normalize";

// [raw bank description, description_clean, vendor_normalized]
const CASES: [string, string, string | null][] = [
  // Payment-processor prefixes
  ["SQ *BLUE BOTTLE COFFEE Oakland CA", "Blue Bottle Coffee", "blue bottle coffee"],
  ["SQ*SIGHTGLASS COFFEE SAN FRANCISCO CA", "Sightglass Coffee", "sightglass coffee"],
  ["TST* JOES DINER 1234 SEATTLE WA", "Joes Diner", "joes diner"],
  ["PAYPAL *ETSY INC 402-935-7733 CA", "Etsy", "etsy"],
  ["PP*ACME WIDGETS", "Acme Widgets", "acme widgets"],
  ["SP * ALLBIRDS", "Allbirds", "allbirds"],
  // Store numbers, city and state
  ["STARBUCKS STORE 12345 SEATTLE WA", "Starbucks", "starbucks"],
  ["STARBUCKS #08723 NEW YORK NY", "Starbucks", "starbucks"],
  ["WALGREENS #1234 CHICAGO IL", "Walgreens", "walgreens"],
  ["MCDONALD'S F12345 PORTLAND OR", "Mcdonald's", "mcdonalds"],
  ["THE HOME DEPOT #6543 AUSTIN TX", "The Home Depot", "home depot"],
  ["SHELL OIL 57444 HOUSTON TX", "Shell Oil", "shell"],
  ["NETFLIX.COM LOS GATOS CA", "Netflix", "netflix"],
  ["SPOTIFY USA 877-778-1161 NY", "Spotify", "spotify"],
  // Wells Fargo statement PDFs (card lines with trace codes, ACH lines with YYMMDD + id + name)
  ["Recurring Payment authorized on 08/25 Bark Technologies, Bark.US NC S100000000000001 Card 1111", "Bark Technologies", "bark technologies"],
  ["Purchase authorized on 08/25 Food Lion #0101 Springfield NC S100000000000002 Card 1111", "Food Lion", "food lion"],
  ["Recurring Payment authorized on 09/06 Netflix.Com Los Gatos CA P100000000000003 Card 2222", "Netflix", "netflix"],
  ["Chase Credit Crd Epay 260827 9000000001 Jane Q Public", "Chase Credit Crd Epay", "chase credit crd epay"],
  ["Acme Co Payroll 260911 01000000-0000-0 Jane Public", "Acme Co Payroll", "acme co payroll"],
  ["Capital One Mobile Pmt CA0Aa0000000A0A Jane Q Public", "Capital One Mobile Pmt", "capital one mobile pmt"],
  ["Online Transfer From Acme Studio, LLC Ref #Ib0Abcdef1 Business Checking Owner Distribution", "Online Transfer From Acme Studio", "online transfer from acme studio"],
  ["Business to Business ACH Debit - Rocket Money Premium St-A1B2C3D4E5F6 Jane Public", "Rocket Money Premium", "rocket money premium"],
  ["Money Transfer Authorized On 07/15 From Intuit", "Intuit", "intuit"],
  // Bank boilerplate, card numbers, dates
  ["CHECKCARD 1012 SHELL OIL 57444 HOUSTON TX", "Shell Oil", "shell"],
  ["POS PURCHASE WALGREENS #1234 CHICAGO IL", "Walgreens", "walgreens"],
  ["PURCHASE AUTHORIZED ON 10/12 TARGET T-1234 MINNEAPOLIS MN CARD 4321", "Target", "target"],
  ["DEBIT CARD PURCHASE XXXXX1234 COSTCO WHSE #0123 ISSAQUAH WA", "Costco", "costco"],
  ["ACH DEBIT GUSTO PAYROLL 123456", "Gusto Payroll", "gusto payroll"],
  ["RECURRING PAYMENT DROPBOX*3QXWLK DROPBOX.COM CA", "Dropbox", "dropbox"],
  // Vendor *product, and aliases that tie variants together
  ["ADOBE *CREATIVE CLOUD 408-536-6000 CA", "Adobe Creative Cloud", "adobe"],
  ["INTUIT *QBOOKS ONLINE CL.INTUIT.COM CA", "Intuit Qbooks Online", "intuit"],
  ["UBER *TRIP HELP.UBER.COM CA", "Uber Trip", "uber"],
  ["UBER *EATS PENDING", "Uber Eats", "uber eats"],
  ["AMAZON.COM*2K4LM8Q90 AMZN.COM/BILLWA", "Amazon", "amazon"],
  ["AMZN Mktp US*1A2B3C4D5", "Amazon", "amazon"],
  ["WM SUPERCENTER #1234 DALLAS TX", "Walmart", "walmart"],
  ["WAL-MART #4321", "Walmart", "walmart"],
  ["GITHUB.COM", "Github", "github"],
  // Nothing to strip
  ["Monthly Service Fee", "Monthly Service Fee", "monthly service fee"],
  ["ONLINE TRANSFER TO SAVINGS XXXXXX1234", "Online Transfer To Savings", "online transfer to savings"],
];

describe("normalizeDescription", () => {
  it(`covers at least 30 realistic descriptions (has ${CASES.length})`, () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });

  it.each(CASES)("%j", (raw, clean, vendor) => {
    expect(normalizeDescription(raw)).toEqual({ description_clean: clean, vendor_normalized: vendor });
  });

  it("gives the same vendor for different spellings of one merchant", () => {
    const v = (s: string) => normalizeDescription(s).vendor_normalized;
    expect(v("SQ *BLUE BOTTLE COFFEE Oakland CA")).toBe(v("SQ*BLUE BOTTLE COFFEE"));
    expect(v("STARBUCKS STORE 12345 SEATTLE WA")).toBe(v("STARBUCKS #08723 NEW YORK NY"));
    expect(v("AMZN Mktp US*1A2B3C4D5")).toBe(v("AMAZON.COM*2K4LM8Q90 AMZN.COM/BILLWA"));
  });

  it("never returns an empty description", () => {
    expect(normalizeDescription("#1234 5678")).toEqual({ description_clean: "#1234 5678", vendor_normalized: null });
    expect(normalizeDescription("   ")).toEqual({ description_clean: "", vendor_normalized: null });
  });

  it("is idempotent on its own output", () => {
    for (const [raw] of CASES) {
      const once = normalizeDescription(raw);
      expect(normalizeDescription(once.description_clean).description_clean).toBe(once.description_clean);
    }
  });
});

describe("known merchants", () => {
  it("groups a merchant's lines under one vendor despite reference codes", () => {
    expect(normalizeDescription("STATE FARM RO 27 CPC-CLIENT 27 S 1234567890 Business Checking"))
      .toEqual({ description_clean: "State Farm", vendor_normalized: "state farm" });
    expect(normalizeDescription("STATE FARM RO 08 SFPP 0987654321")?.vendor_normalized).toBe("state farm");
    expect(normalizeDescription("VERIZON WIRELESS PAYMENTS 260702 4455667788 MAINLAND")?.vendor_normalized).toBe("verizon");
  });
});
