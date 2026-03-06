import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

type KidDocument = {
  id: string;
  title: string | null;
  category: string | null;
  created_at: string;
};

export async function GET(request: NextRequest) {
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

    const admin = getServiceRoleClient();

    const { data: docs, error } = await admin
      .from("documents")
      .select("id, title, category, created_at, visibility, deleted_at, case_id")
      .eq("case_id", caseId)
      .eq("visibility", "family")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { message: error.message ?? "Failed to load documents" },
        { status: 500 }
      );
    }

    const items: KidDocument[] = (docs ?? []).map((d) => ({
      id: d.id as string,
      title: (d.title as string | null) ?? null,
      category: (d.category as string | null) ?? null,
      created_at: d.created_at as string,
    }));

    return NextResponse.json({ documents: items });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error ? e.message : "Failed to load documents",
      },
      { status: 500 }
    );
  }
}

