// PDF rendering of a report with @react-pdf/renderer (pure JS, no browser needed on the
// server): title block, the statement lines, and "Page n of m" on every page.
import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatCents, type Cents } from "@/lib/money";
import { headerRow, lineFigures, type ReportDocument } from "./document";
import { BRAND_NAME } from "@/lib/theme";

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 48, paddingHorizontal: 40, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  business: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 2 },
  meta: { fontSize: 9, color: "#555", marginTop: 2 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#999", paddingBottom: 3, marginTop: 14, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", paddingVertical: 2 },
  label: { flexGrow: 1, flexShrink: 1 },
  amount: { width: 82, textAlign: "right" },
  pct: { width: 52, textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
  heading: { fontFamily: "Helvetica-Bold", marginTop: 8 },
  rule: { borderTopWidth: 0.5, borderColor: "#999" },
  grand: { borderTopWidth: 1, borderBottomWidth: 2, borderColor: "#333", marginTop: 4 },
  warn: { color: "#b45309" },
  footer: { position: "absolute", bottom: 20, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: "#777" },
});

const money = (c: Cents | null) => (c === null ? "" : formatCents(c, { negative: "parens" }));

function Report({ doc }: { doc: ReportDocument }) {
  const hasCmp = doc.statement.hasComparison;
  const cols = headerRow(doc);
  return (
    <Document title={`${doc.businessName} — ${doc.title}`} author={BRAND_NAME} creator={BRAND_NAME}>
      <Page size="LETTER" style={s.page} wrap>
        <View fixed>
          <Text style={s.business}>{doc.businessName}</Text>
          <Text style={s.title}>{doc.title}</Text>
          <Text style={s.meta}>{doc.period} · Basis: {doc.basis}</Text>
          <View style={s.head}>
            <Text style={s.label}>{cols[0]}</Text>
            {cols.slice(1).map((c, i) => <Text key={c} style={i === 3 ? s.pct : s.amount}>{c}</Text>)}
          </View>
        </View>
        {doc.statement.lines.map((l) => {
          const f = lineFigures(l, hasCmp);
          const isTotal = l.kind === "total" || l.kind === "subtotal";
          return (
            <View key={l.key} wrap={false}
              style={[s.row, l.kind === "heading" ? s.heading : {}, isTotal ? s.rule : {}, l.kind === "grand" ? s.grand : {}]}>
              <Text style={[s.label, { paddingLeft: l.depth * 12 }, l.kind !== "account" ? s.bold : {}, l.warn ? s.warn : {}]}>
                {l.label}{l.warn ? "  (needs review)" : ""}
              </Text>
              {l.kind !== "heading" && l.kind !== "parent" && (
                <>
                  <Text style={[s.amount, l.kind !== "account" ? s.bold : {}]}>{money(f.cents)}</Text>
                  {hasCmp && <Text style={[s.amount, l.kind !== "account" ? s.bold : {}]}>{money(f.cmpCents)}</Text>}
                  {hasCmp && <Text style={s.amount}>{money(f.change)}</Text>}
                  {hasCmp && <Text style={s.pct}>{f.pct ?? "—"}</Text>}
                </>
              )}
            </View>
          );
        })}
        <View style={s.footer} fixed>
          <Text>Generated {doc.generatedAt}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function toPdf(doc: ReportDocument): Promise<Buffer> {
  return renderToBuffer(<Report doc={doc} />);
}
