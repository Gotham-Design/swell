import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Money } from "./money";

describe("<Money>", () => {
  it("formats cents with a spoken label and tabular figures", () => {
    const html = renderToStaticMarkup(<Money cents={351634} />);
    expect(html).toContain('aria-label="3,516 dollars and 34 cents"');
    expect(html).toContain("tabular-nums");
    expect(html).toContain("$3,516.34");
  });

  it("splits off the cents in muted grey", () => {
    const html = renderToStaticMarkup(<Money cents={351634} split />);
    expect(html).toContain(">$3,516</span><span aria-hidden=\"true\" class=\"text-muted-foreground\">.34</span>");
  });

  it("colours by direction when signed", () => {
    expect(renderToStaticMarkup(<Money cents={-4500} tone="signed" />)).toContain("text-money-out-text");
    expect(renderToStaticMarkup(<Money cents={4500} tone="signed" signPositive />)).toContain("+$45.00");
    expect(renderToStaticMarkup(<Money cents={0} tone="signed" />)).not.toContain("text-money");
  });
});
