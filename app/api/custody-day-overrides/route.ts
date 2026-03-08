import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

async function getCaseIdForUser(admin: ReturnType<typeof getServiceRoleClient>, userId: string) {
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return membership?.case_id ?? null;
}

/**
 * GET /api/custody-day-overrides — fetch all custody_day_overrides for the current user's case_id.
 * Table: custody_day_overrides. Filters: case_id, deleted_at IS NULL.
 */
export async function GET() {
  console.log("custody-day-overrides GET called");
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const caseId = await getCaseIdForUser(admin, user.id);
    console.log("custody-day-overrides GET case_id:", caseId);
    if (!caseId) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const { data: rows, error } = await admin
      .from("custody_day_overrides")
      .select("*")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("date", { ascending: true });

    if (error) {
      console.error("custody-day-overrides GET query error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(rows ?? []);
  } catch (error: unknown) {
    console.error("custody-day-overrides GET error:", error);
    const err = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: err.message ?? "Failed to load custody day overrides", stack: err.stack },
      { status: 500 }
    );
  }
}

type OverrideRow = { date: string; custodial_parent: string };

function normalizeBody(
  body: unknown
): OverrideRow[] {
  if (Array.isArray(body)) {
    return body.filter(
      (item): item is OverrideRow =>
        item != null &&
        typeof item === "object" &&
        typeof (item as OverrideRow).date === "string" &&
        typeof (item as OverrideRow).custodial_parent === "string"
    );
  }
  if (body != null && typeof body === "object" && "date" in body && "custodial_parent" in body) {
    const single = body as OverrideRow;
    return [single];
  }
  return [];
}

/**
 * POST /api/custody-day-overrides — upsert by case_id + date.
 * Body: single { date, custodial_parent } or array [{ date, custodial_parent }, ...].
 * For each row: if exists for case_id + date, UPDATE custodial_parent; else INSERT.
 */
export async function POST(req: NextRequest) {
  console.log("custody-day-overrides POST called");
  try {
    const body = await req.json().catch(() => ({}));
    console.log("custody-day-overrides POST body:", body);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const caseId = await getCaseIdForUser(admin, user.id);
    console.log("case_id:", caseId);
    if (!caseId) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const rows = normalizeBody(body);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields: date and custodial_parent (single object or array)" },
        { status: 400 }
      );
    }

    for (const { date, custodial_parent } of rows) {
      const { data: existing, error: selectError } = await admin
        .from("custody_day_overrides")
        .select("id")
        .eq("case_id", caseId)
        .eq("date", date)
        .limit(1)
        .maybeSingle();

      if (selectError) {
        console.error("[custody-day-overrides POST] select error for", date, selectError);
        return NextResponse.json({ error: selectError.message }, { status: 500 });
      }

      if (existing?.id) {
        const { error: updateError } = await admin
          .from("custody_day_overrides")
          .update({ custodial_parent })
          .eq("case_id", caseId)
          .eq("date", date);

        if (updateError) {
          console.error("[custody-day-overrides POST] update error for", date, updateError);
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }
      } else {
        const { error: insertError } = await admin
          .from("custody_day_overrides")
          .insert({
            case_id: caseId,
            date,
            custodial_parent,
          });

        if (insertError) {
          console.error("[custody-day-overrides POST] insert error for", date, insertError);
          return NextResponse.json({ error: insertError.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (error) {
    console.error("custody-day-overrides POST error:", error);
    const message = error instanceof Error ? error.message : "Failed to save custody day override";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/custody-day-overrides — remove override for a date (query param: date=YYYY-MM-DD).
 */
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const caseId = await getCaseIdForUser(admin, user.id);
    if (!caseId) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    if (!date) return NextResponse.json({ error: "Missing date" }, { status: 400 });

    const { error } = await admin
      .from("custody_day_overrides")
      .delete()
      .eq("case_id", caseId)
      .eq("date", date);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[custody-day-overrides DELETE]", e);
    return NextResponse.json({ error: "Failed to delete custody day override" }, { status: 500 });
  }
}
