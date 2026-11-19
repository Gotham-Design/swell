import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";
import { safeEqual, sameOrigin } from "./compare";

describe("safeEqual", () => {
  it("matches equal strings only", () => {
    expect(safeEqual("Bearer abc", "Bearer abc")).toBe(true);
    expect(safeEqual("Bearer abc", "Bearer abd")).toBe(false);
    expect(safeEqual("", "Bearer abc")).toBe(false);
  });
});

describe("sameOrigin", () => {
  const req = (h: Record<string, string>) => new Request("https://app.example.com/auth/signout", { method: "POST", headers: h });
  it("accepts this site and refuses others", () => {
    expect(sameOrigin(req({ origin: "https://app.example.com" }))).toBe(true);
    expect(sameOrigin(req({ referer: "https://app.example.com/b/1" }))).toBe(true);
    expect(sameOrigin(req({ origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(req({}))).toBe(false);
    expect(sameOrigin(req({ origin: "null" }))).toBe(false);
  });
});
