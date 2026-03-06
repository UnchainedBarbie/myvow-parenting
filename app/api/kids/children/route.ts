import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

type KidChild = {
  id: string;
  first_name: string;
  avatar_url: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const familyCodeRaw = searchParams.get("family_code");

    if (!familyCodeRaw || typeof familyCodeRaw !== "string") {
      return NextResponse.json(
        { message: "family_code is required" },
        { status: 400 }
      );
    }

    const familyCode = familyCodeRaw.trim();
    if (!familyCode) {
      return NextResponse.json(
        { message: "family_code is required" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    // Look up case by family_code. Family code is the credential for kids.
    const { data: caseRow, error: caseError } = await admin
      .from("cases")
      .select("id")
      .eq("family_code", familyCode)
      .maybeSingle();

    if (caseError) {
      return NextResponse.json(
        { message: caseError.message ?? "Failed to look up family" },
        { status: 500 }
      );
    }

    if (!caseRow) {
      return NextResponse.json(
        { message: "Family code not found" },
        { status: 404 }
      );
    }

    const { data: children, error: childrenError } = await admin
      .from("children")
      .select("id, first_name, profile_image")
      .eq("case_id", caseRow.id)
      .is("deleted_at", null)
      .order("first_name", { ascending: true });

    if (childrenError) {
      return NextResponse.json(
        { message: childrenError.message ?? "Failed to load children" },
        { status: 500 }
      );
    }

    const kids: KidChild[] = (children ?? []).map((c) => ({
      id: c.id as string,
      first_name: (c.first_name as string) ?? "",
      avatar_url: ((c as { profile_image?: string | null }).profile_image ??
        null) as string | null,
    }));

    if (kids.length === 0) {
      return NextResponse.json(
        { message: "Family code not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ children: kids });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error
            ? e.message
            : "Failed to look up children for family code",
      },
      { status: 500 }
    );
  }
}

