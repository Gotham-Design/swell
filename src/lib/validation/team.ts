// Team (firm) forms: shared by the dialogs and the server actions that re-check them.
import { z } from "zod";

export const teamAccessSchema = z.object({
  role: z.enum(["admin", "staff"], "Pick a role"),
  clients: z.enum(["all", "selected"]),
  client_role: z.enum(["editor", "viewer"]),
  business_ids: z.array(z.uuid()).max(500),
}).superRefine((v, ctx) => {
  if (v.role === "staff" && v.clients === "selected" && !v.business_ids.length) {
    ctx.addIssue({ code: "custom", path: ["business_ids"], message: "Pick at least one client" });
  }
});

export const teamInviteSchema = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter an email address")) }).and(teamAccessSchema);

export const firmNameSchema = z.object({ name: z.string().trim().min(1, "Give the firm a name").max(120) });

/** "Every client · can edit", "2 clients · view only", "Admin · everything". */
export function accessSummary(m: { role: "admin" | "staff"; all_clients: boolean; client_role: string; business_ids: string[] }) {
  if (m.role === "admin") return "Every client · manages the team";
  const clients = m.all_clients ? "Every client" : `${m.business_ids.length} client${m.business_ids.length === 1 ? "" : "s"}`;
  return `${clients} · ${m.client_role === "viewer" ? "view only" : "can edit"}`;
}
