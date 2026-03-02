import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

type VowRow = {
  id: string;
  case_id: string;
  user_id: string;
  content: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const caseId = (membership?.case_id as string | undefined) ?? null;
    if (!caseId) {
      return NextResponse.json({ vows: [] });
    }

    const { data, error } = await admin
      .from("vows")
      .select("id, case_id, user_id, content, is_pinned, created_at, updated_at, deleted_at")
      .eq("case_id", caseId)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    const vows: VowRow[] = (data ?? []).map((v) => ({
      id: v.id as string,
      case_id: v.case_id as string,
      user_id: v.user_id as string,
      content: (v.content as string) ?? "",
      is_pinned: (v.is_pinned as boolean) ?? false,
      created_at: v.created_at as string,
      updated_at: v.updated_at as string,
    }));

    return NextResponse.json({ vows });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load vows" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { id, content, is_pinned } = body as {
      id?: string;
      content?: string;
      is_pinned?: boolean;
    };

    if (!content || !content.trim()) {
      return NextResponse.json(
        { message: "Vow content is required." },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const caseId = (membership?.case_id as string | undefined) ?? null;
    if (!caseId) {
      return NextResponse.json(
        { message: "Could not resolve case for vow." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    let saved: VowRow | null = null;

    if (id) {
      const { data, error } = await admin
        .from("vows")
        .update({
          content,
          is_pinned: is_pinned ?? false,
          updated_at: now,
        })
        .eq("id", id)
        .eq("case_id", caseId)
        .eq("user_id", user.id)
        .select("id, case_id, user_id, content, is_pinned, created_at, updated_at")
        .maybeSingle();

      if (error) {
        return NextResponse.json(
          { message: error.message },
          { status: 500 }
        );
      }
      if (!data) {
        return NextResponse.json(
          { message: "Vow not found." },
          { status: 404 }
        );
      }

      saved = {
        id: data.id as string,
        case_id: data.case_id as string,
        user_id: data.user_id as string,
        content: (data.content as string) ?? "",
        is_pinned: (data.is_pinned as boolean) ?? false,
        created_at: data.created_at as string,
        updated_at: data.updated_at as string,
      };
    } else {
      const { data, error } = await admin
        .from("vows")
        .insert({
          case_id: caseId,
          user_id: user.id,
          content,
          is_pinned: is_pinned ?? false,
          created_at: now,
          updated_at: now,
        })
        .select("id, case_id, user_id, content, is_pinned, created_at, updated_at")
        .single();

      if (error) {
        return NextResponse.json(
          { message: error.message },
          { status: 500 }
        );
      }

      saved = {
        id: data.id as string,
        case_id: data.case_id as string,
        user_id: data.user_id as string,
        content: (data.content as string) ?? "",
        is_pinned: (data.is_pinned as boolean) ?? false,
        created_at: data.created_at as string,
        updated_at: data.updated_at as string,
      };
    }

    if (saved && saved.is_pinned) {
      // Unpin other vows for this user/case
      await admin
        .from("vows")
        .update({ is_pinned: false, updated_at: now })
        .eq("case_id", saved.case_id)
        .eq("user_id", saved.user_id)
        .neq("id", saved.id);
    }

    return NextResponse.json({ vow: saved });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to save vow" },
      { status: 500 }
    );
  }
}

