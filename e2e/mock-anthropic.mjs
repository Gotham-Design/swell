// A stand-in for the Anthropic Messages API, for e2e only (playwright.config.ts points
// the app's SDK here with ANTHROPIC_BASE_URL). Category requests get a tool call that
// picks a category by keyword; anything else gets a short text answer.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_ANTHROPIC_PORT ?? 3299);
const KEYWORDS = [
  [/coffee|cafe|lunch|diner|restaurant/i, "Meals"],
  [/adobe|figma|github|zoom|software|slack/i, "Software & Subscriptions"],
  [/uber|lyft|airline|hotel/i, "Travel"],
  [/client|invoice|payment received|deposit/i, "Sales"],
];

function suggest(body) {
  const tool = (body.tools ?? []).find((t) => t.name === "record_category_suggestions");
  const system = (Array.isArray(body.system) ? body.system.map((b) => b.text).join("\n") : body.system ?? "");
  const categories = JSON.parse(system.split("Business categories and history:\n")[1] ?? "{}").categories ?? [];
  const user = body.messages[0].content;
  const txns = JSON.parse(String(user).split("\n").slice(1).join("\n"));
  const byName = new Map(categories.map((c) => [c.name, c.id]));
  const fallback = categories.find((c) => c.name === "Other Expense")?.id ?? categories[0].id;
  const suggestions = txns.map((t) => {
    const hit = KEYWORDS.find(([re]) => re.test(t.description));
    const id = (hit && byName.get(hit[1])) ?? fallback;
    return { transaction_id: t.id, category_id: id, confidence: hit ? 0.93 : 0.4,
      reason: hit ? `Looks like ${hit[1].toLowerCase()}` : "Not sure", flags: [] };
  });
  return {
    content: [{ type: "tool_use", id: `toolu_${Date.now()}`, name: tool.name, input: { suggestions } }],
    stop_reason: "tool_use",
  };
}

createServer((req, res) => {
  if (req.method === "GET") { res.writeHead(200).end("ok"); return; }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    const answer = body.tools?.length
      ? suggest(body)
      : { content: [{ type: "text", text: "A steady month: income covered expenses, with a few uncategorized items left to review." }], stop_reason: "end_turn" };
    res.writeHead(200, { "content-type": "application/json", "request-id": `req_${Date.now()}` });
    res.end(JSON.stringify({
      id: `msg_${Date.now()}`, type: "message", role: "assistant", model: body.model, stop_sequence: null,
      usage: { input_tokens: 1500, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      ...answer,
    }));
  });
}).listen(port, "127.0.0.1", () => console.log(`mock anthropic on ${port}`));
