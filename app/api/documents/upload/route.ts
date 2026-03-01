import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 250;
const VISIBILITY_VALUES = ["family", "parents_only", "private"] as const;

/**
 * Upload to Supabase Storage + create document metadata. Court-ready vault.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const case_id = formData.get("case_id") as string | null;
    const title = formData.get("title") as string | null;
    const category = formData.get("category") as string | null;
    const childIdsRaw = formData.getAll("child_ids");
    const child_ids = Array.isArray(childIdsRaw) ? (childIdsRaw as string[]).filter(Boolean) : [];
    const description = formData.get("description") as string | null;
    const visibility = formData.get("visibility") as string | null;

    if (!file || !case_id) {
      return NextResponse.json({ message: "Missing file or case_id" }, { status: 400 });
    }

    const titleTrimmed = title?.trim() ?? "";
    if (!titleTrimmed) {
      return NextResponse.json({ message: "Document title is required." }, { status: 400 });
    }
    if (titleTrimmed.length > TITLE_MAX) {
      return NextResponse.json(
        { message: `Title must be ${TITLE_MAX} characters or fewer.` },
        { status: 400 }
      );
    }

    const descTrimmed = description?.trim() ?? "";
    if (!descTrimmed) {
      return NextResponse.json({ message: "Description is required." }, { status: 400 });
    }
    if (descTrimmed.length > DESCRIPTION_MAX) {
      return NextResponse.json(
        { message: `Description must be ${DESCRIPTION_MAX} characters or fewer.` },
        { status: 400 }
      );
    }

    const visibilityValue =
      visibility && VISIBILITY_VALUES.includes(visibility as (typeof VISIBILITY_VALUES)[number])
        ? visibility
        : "family";

    const admin = getServiceRoleClient();
    const path = `${case_id}/${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from("documents")
      .upload(path, buf, { contentType: file.type, upsert: false });
    if (uploadError) {
      return NextResponse.json({ message: uploadError.message }, { status: 500 });
    }

    const insertPayload: Record<string, unknown> = {
      case_id,
      uploaded_by: user.id,
      title: titleTrimmed,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type,
      storage_path: path,
      category: category ?? "other",
      child_id: null,
      description: descTrimmed,
      content_hash: "pending",
      visibility: visibilityValue,
      ai_processed: false,
    };

    const { data: doc, error: docError } = await admin
      .from("documents")
      .insert(insertPayload)
      .select("id")
      .single();
    if (docError) {
      return NextResponse.json({ message: docError.message }, { status: 500 });
    }

    if (child_ids.length > 0) {
      const rows = child_ids.map((child_id) => ({ document_id: doc.id, child_id }));
      const { error: juncError } = await admin.from("document_children").insert(rows);
      if (juncError) {
        console.warn("[documents/upload] document_children insert failed:", juncError.message);
      }
    }

    return NextResponse.json({ document_id: doc.id });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Upload failed" },
      { status: 500 }
    );
  }
}
