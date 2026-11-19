// Open a document: a one-minute signed link to the private file, made as the signed-in user
// (storage policies decide; members of the business only).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ businessId: string; documentId: string }> }) {
  const { businessId, documentId } = await params;
  const supabase = await createClient();
  const { data: d } = await supabase.from("documents").select("storage_path, file_name")
    .eq("id", documentId).eq("business_id", businessId).maybeSingle();
  if (!d) return new Response("Not found", { status: 404 });
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(d.storage_path, 60);
  if (error || !data) return new Response("Couldn't open that file", { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
