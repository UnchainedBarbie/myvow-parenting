import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import archiver from "archiver";
import { PassThrough, Readable } from "stream";

const BUCKET = "documents";

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

    console.log("[download-selected] Bucket name (check for typos/case):", JSON.stringify(BUCKET));
    console.log("[download-selected] Method: Supabase SDK storage.download(path) — not getPublicUrl() or createSignedUrl(); path is relative to bucket.");

    const collected: { name: string; buffer: Buffer }[] = [];
    for (const doc of docs) {
      const fileName = doc.file_name ?? "document";
      const storagePath = doc.storage_path;
      if (!storagePath || typeof storagePath !== "string") {
        console.error("[download-selected] Invalid storage_path for doc", doc.id, storagePath);
        continue;
      }
      const publicUrlResult = admin.storage.from(BUCKET).getPublicUrl(storagePath);
      const storageUrl = publicUrlResult?.data?.publicUrl ?? "(getPublicUrl not available)";
      console.log("Downloading file:", {
        fileName,
        filePath: storagePath,
        storageUrl,
        pathIncludesBucketPrefix: storagePath.startsWith(BUCKET + "/") || storagePath === BUCKET,
      });
      try {
        const { data, error: downloadError } = await admin.storage.from(BUCKET).download(storagePath);
        if (downloadError) {
          console.error("File download failed:", {
            fileName,
            error: downloadError,
            status: (downloadError as { status?: number })?.status,
            statusText: (downloadError as { statusText?: string })?.statusText,
          });
          continue;
        }
        if (data) {
          const arrayBuffer = await data.arrayBuffer();
          collected.push({ name: fileName, buffer: Buffer.from(arrayBuffer) });
        }
      } catch (e) {
        const err = e as { status?: number; statusText?: string };
        console.error("File download failed:", {
          fileName,
          error: e,
          status: err?.status,
          statusText: err?.statusText,
        });
      }
    }

    if (collected.length === 0) {
      const debugInfo = docs.map((doc) => ({
        id: doc.id,
        file_name: doc.file_name,
        storage_path: doc.storage_path,
      }));

      const { data: bucketFiles, error: listError } = await admin.storage.from(BUCKET).list("", { limit: 20 });

      return new Response(
        JSON.stringify({
          error: "All files failed to download.",
          debug: {
            bucket: BUCKET,
            attempted_paths: debugInfo,
            bucket_root_contents: bucketFiles?.map((f: { name?: string }) => f.name) ?? [],
            bucket_list_error: listError?.message ?? null,
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const archive = archiver("zip", { zlib: { level: 6 } });
    const pass = new PassThrough();
    archive.pipe(pass);

    (async () => {
      try {
        for (const f of collected) {
          archive.append(f.buffer, { name: f.name });
        }
        await archive.finalize();
      } catch (e) {
        console.error("[download-selected] Archive finalize error:", e);
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
    console.error("[download-selected] Route error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
