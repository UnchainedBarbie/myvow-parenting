import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import archiver from "archiver";
import { PassThrough, Readable } from "stream";

/**
 * POST /api/documents/download-selected — stream a ZIP of selected documents.
 * Body: { ids: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response("Unauthorized", { status: 401 });

    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? (body.ids as string[]).filter((id) => typeof id === "string") : [];
    if (ids.length === 0) return new Response(JSON.stringify({ error: "No ids" }), { status: 400 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin.from("case_members").select("case_id").eq("user_id", user.id).limit(1).maybeSingle();
    if (!membership) return new Response("Forbidden", { status: 403 });

    const { data: docs, error } = await admin
      .from("documents")
      .select("id, case_id, storage_path, file_name")
      .in("id", ids)
      .eq("case_id", membership.case_id);
    if (error || !docs?.length) return new Response(JSON.stringify({ error: "No documents found" }), { status: 404 });

    const archive = archiver("zip", { zlib: { level: 6 } });
    const pass = new PassThrough();
    archive.pipe(pass);

    (async () => {
      try {
        for (const doc of docs) {
          const { data } = await admin.storage.from("documents").download(doc.storage_path);
          if (data) archive.append(Buffer.from(data), { name: doc.file_name });
        }
        await archive.finalize();
      } catch (e) {
        archive.emit("error", e);
      }
    })();

    const webStream = Readable.toWeb(pass) as ReadableStream;
    return new Response(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="documents.zip"',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Failed" }), { status: 500 });
  }
}
