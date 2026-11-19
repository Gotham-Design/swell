import { describe, expect, it } from "vitest";
import { businessSchema, lockDateSchema, parseForm } from "./business";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("businessSchema", () => {
  const valid = { name: " Acme ", legal_name: "", currency: "USD", fiscal_year_start_month: "7", books_start_date: "" };

  it("trims, coerces and turns blanks into null", () => {
    expect(businessSchema.parse(valid)).toEqual({
      name: "Acme", legal_name: null, currency: "USD", fiscal_year_start_month: 7, books_start_date: null, tax_form: null,
    });
  });

  it("keeps a books start date", () => {
    expect(businessSchema.parse({ ...valid, books_start_date: "2026-01-01" }).books_start_date).toBe("2026-01-01");
  });

  it.each([
    [{ name: "  " }, "name"],
    [{ currency: "BTC" }, "currency"],
    [{ fiscal_year_start_month: "13" }, "fiscal_year_start_month"],
    [{ fiscal_year_start_month: "0" }, "fiscal_year_start_month"],
    [{ books_start_date: "2026-02-30" }, "books_start_date"],
    [{ books_start_date: "01/01/2026" }, "books_start_date"],
    [{ tax_form: "form_1065" }, "tax_form"],
  ])("rejects %j", (patch, field) => {
    const r = parseForm(businessSchema, form({ ...valid, ...patch }));
    expect(r.state?.fieldErrors?.[field]?.length).toBeGreaterThan(0);
  });
});

describe("lockDateSchema", () => {
  it("clears the lock with an empty value", () => {
    expect(lockDateSchema.parse({ lock_date: "" })).toEqual({ lock_date: null });
    expect(lockDateSchema.parse({ lock_date: "2026-03-31" })).toEqual({ lock_date: "2026-03-31" });
  });
});

