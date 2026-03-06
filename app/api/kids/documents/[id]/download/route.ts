import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json(
        { message: "Not logged in" },
        { status: 401 }
      );
    }

    const child = session.child as { case_id?: string | null };
    const caseId = child.case_id ?? null;

    if (!caseId) {
      return NextResponse.json(
        { message: "No family case found" },
        { status: 400 }
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json(
        { message: "Missing document id" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select("id, case_id, storage_path, file_name, visibility, deleted_at")
      .eq("id", id)
      .eq("case_id", caseId)
      .eq("visibility", "family")
      .is("deleted_at", null)
      .maybeSingle();

    if (docErr) {
      return NextResponse.json(
        { message: docErr.message ?? "Failed to load document" },
        { status: 500 }
      );
    }
    if (!doc) {
      return NextResponse.json(
        { message: "Document not found" },
        { status: 404 }
      );
    }

    const { data: signed, error: signedErr } = await admin.storage
      .from("documents")
      .createSignedUrl(doc.storage_path as string, 60, {
        download: doc.file_name as string,
      });

    if (signedErr || !signed?.signedUrl) {
      return NextResponse.json(
        { message: signedErr?.message ?? "Could not generate download URL" },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: signed.signedUrl });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error ? e.message : "Failed to generate download link",
      },
      { status: 500 }
    );
  }
}

