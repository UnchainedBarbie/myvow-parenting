import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { isMissingRelation, isRecordCategoryId, type RecordCategoryId } from "@/lib/record/record-categories";

const UNAVAILABLE =
  "Conversation categories are not in the database yet. Run the conversation_categories migration in Supabase.";

async function authorize(conversationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const admin = getServiceRoleClient();
  const { data: conversation, error } = await admin
    .from("conversations")
    .select("id, case_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!conversation) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  const { data: membership } = await admin
    .from("case_members")
    .select("id")
    .eq("case_id", conversation.case_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  return { admin, userId: user.id, caseId: conversation.case_id as string };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authorize(params.id);
  if ("error" in auth && auth.error) return auth.error;

  const { data, error } = await auth.admin
    .from("conversation_categories")
    .select("category")
    .eq("conversation_id", params.id)
    .eq("case_id", auth.caseId);

  if (error) {
    if (isMissingRelation(error)) {
      return NextResponse.json({ categories: [], available: false });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const categories = (data ?? [])
    .map((row) => (row as { category?: string }).category ?? "")
    .filter(isRecordCategoryId);
  return NextResponse.json({ categories, available: true });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authorize(params.id);
  if ("error" in auth && auth.error) return auth.error;

  const body = (await request.json().catch(() => ({}))) as { categories?: unknown };
  if (!Array.isArray(body.categories)) {
    return NextResponse.json({ error: "categories must be a list." }, { status: 400 });
  }
  const categories = [...new Set(body.categories.filter((value): value is RecordCategoryId =>
    typeof value === "string" && isRecordCategoryId(value)
  ))];

  const { data: existing, error: readError } = await auth.admin
    .from("conversation_categories")
    .select("category")
    .eq("conversation_id", params.id)
    .eq("case_id", auth.caseId);

  if (readError) {
    if (isMissingRelation(readError)) {
      return NextResponse.json({ error: UNAVAILABLE, available: false }, { status: 503 });
    }
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  const current = new Set(
    (existing ?? [])
      .map((row) => (row as { category?: string }).category ?? "")
      .filter(isRecordCategoryId)
  );
  const next = new Set(categories);
  const toRemove = [...current].filter((category) => !next.has(category));
  const toAdd = categories.filter((category) => !current.has(category));

  if (toRemove.length > 0) {
    const { error } = await auth.admin
      .from("conversation_categories")
      .delete()
      .eq("conversation_id", params.id)
      .eq("case_id", auth.caseId)
      .in("category", toRemove);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (toAdd.length > 0) {
    const { error } = await auth.admin.from("conversation_categories").insert(
      toAdd.map((category) => ({
        conversation_id: params.id,
        case_id: auth.caseId,
        category,
        created_by: auth.userId,
      }))
    );
    if (error) {
      if (isMissingRelation(error)) {
        return NextResponse.json({ error: UNAVAILABLE, available: false }, { status: 503 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ categories, available: true });
}
