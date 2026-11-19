// A file a client sent, for the importer to read. Session client: storage and row policies
// decide (owners and editors of this business only).
import { getBusiness, getSupabase } from "@/lib/dal";

export async function GET(_req: Request, { params }: RouteContext<"/b/[businessId]/import/uploads/[uploadId]">) {
  const { businessId, uploadId } = await params;
  const { canWrite } = await getBusiness(businessId);
  if (!canWrite || !/^[0-9a-f-]{36}$/i.test(uploadId)) return new Response("Not found", { status: 404 });
  const supabase = await getSupabase();
  const { data: u } = await supabase.from("statement_uploads").select("file_name, content_type, storage_path")
    .eq("id", uploadId).eq("business_id", businessId).is("deleted_at", null).maybeSingle();
  if (!u) return new Response("Not found", { status: 404 });
  const file = await supabase.storage.from("client-statements").download(u.storage_path);
  if (file.error || !file.data) return new Response("Not found", { status: 404 });
  return new Response(file.data, {
    headers: {
      "Content-Type": u.content_type,
      "Content-Disposition": `attachment; filename="${u.file_name.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
