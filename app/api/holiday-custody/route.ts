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
 * GET /api/holiday-custody — fetch holiday_custody rows for the current user's case.
 * Query: ?year= — filter by year. Returns id, holiday_name, start_date, end_date, custodial_parent, year. Excludes deleted_at.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const caseId = await getCaseIdForUser(admin, user.id);
    if (!caseId) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get("year");
    const yearFilter = yearParam != null && yearParam !== "" ? parseInt(yearParam, 10) : null;

    let query = admin
      .from("holiday_custody")
      .select("id, holiday_name, start_date, end_date, custodial_parent, year, odd_year_parent, even_year_parent, notes, is_relative")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("year", { ascending: true })
      .order("start_date", { ascending: true });

    if (yearFilter != null && !Number.isNaN(yearFilter)) {
      query = query.eq("year", yearFilter);
    }

    const { data: rows, error } = await query;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(rows ?? []);
  } catch (e) {
    console.error("[holiday-custody GET]", e);
    return NextResponse.json({ error: "Failed to load holiday custody" }, { status: 500 });
  }
}

/**
 * POST /api/holiday-custody — insert a new holiday_custody row (case_id, holiday_name, year, start_date, end_date, custodial_parent, source defaults to 'manual').
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const caseId = await getCaseIdForUser(admin, user.id);
    if (!caseId) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as {
      holiday_name?: string;
      year?: number;
      start_date?: string;
      end_date?: string;
      custodial_parent?: string;
    };

    if (body.holiday_name == null || body.year == null || body.start_date == null || body.end_date == null || body.custodial_parent == null) {
      return NextResponse.json(
        { error: "Missing required fields: holiday_name, year, start_date, end_date, custodial_parent" },
        { status: 400 }
      );
    }

    const payload = {
      case_id: caseId,
      holiday_name: String(body.holiday_name),
      year: Number(body.year),
      start_date: String(body.start_date),
      end_date: String(body.end_date),
      custodial_parent: String(body.custodial_parent),
      source: "manual",
    };

    const { data: row, error } = await admin
      .from("holiday_custody")
      .insert(payload)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(row);
  } catch (e) {
    console.error("[holiday-custody POST]", e);
    return NextResponse.json({ error: "Failed to create holiday custody" }, { status: 500 });
  }
}

/**
 * PUT /api/holiday-custody — update an existing holiday_custody row by id (holiday_name, start_date, end_date, custodial_parent, source = 'manual').
 */
export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const caseId = await getCaseIdForUser(admin, user.id);
    if (!caseId) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      holiday_name?: string;
      start_date?: string;
      end_date?: string;
      custodial_parent?: string;
    };

    const id = body.id;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const { data: existing, error: fetchError } = await admin
      .from("holiday_custody")
      .select("id, case_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchError || !existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.case_id !== caseId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const updates: Record<string, unknown> = { source: "manual" };
    if (body.holiday_name !== undefined) updates.holiday_name = body.holiday_name;
    if (body.start_date !== undefined) updates.start_date = body.start_date;
    if (body.end_date !== undefined) updates.end_date = body.end_date;
    if (body.custodial_parent !== undefined) updates.custodial_parent = body.custodial_parent;

    const { data: row, error } = await admin
      .from("holiday_custody")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(row);
  } catch (e) {
    console.error("[holiday-custody PUT]", e);
    return NextResponse.json({ error: "Failed to update holiday custody" }, { status: 500 });
  }
}

