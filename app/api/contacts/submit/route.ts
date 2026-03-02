import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

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
    const {
      id,
      case_id,
      name,
      role,
      organization,
      phone,
      email,
      address,
      notes,
      visibility,
      child_ids,
      is_emergency,
    } = body as {
      id?: string;
      case_id?: string;
      name?: string;
      role?: string | null;
      organization?: string | null;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      notes?: string | null;
      visibility?: string | null;
      child_ids?: string[];
      is_emergency?: boolean;
    };

    if (!name || (!case_id && !id)) {
      return NextResponse.json(
        { message: "Missing name or case_id." },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    let effectiveCaseId = case_id ?? null;
    if (!effectiveCaseId && id) {
      const { data: existing } = await admin
        .from("contacts")
        .select("case_id")
        .eq("id", id)
        .maybeSingle();
      effectiveCaseId = (existing?.case_id as string | undefined) ?? null;
    }

    if (!effectiveCaseId) {
      return NextResponse.json(
        { message: "Could not resolve case for contact." },
        { status: 400 }
      );
    }

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .eq("case_id", effectiveCaseId)
      .limit(1)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const baseFields = {
      case_id: effectiveCaseId,
      name,
      role: role ?? null,
      organization: organization ?? null,
      phone: phone ?? null,
      email: email ?? null,
      address: address ?? null,
      notes: notes ?? null,
      visibility: visibility ?? "parents",
      is_emergency: is_emergency ?? false,
      updated_at: new Date().toISOString(),
    };

    let contactId: string;

    if (id) {
      const { data: updated, error } = await admin
        .from("contacts")
        .update(baseFields)
        .eq("id", id)
        .eq("case_id", effectiveCaseId)
        .select("id")
        .maybeSingle();

      if (error) {
        return NextResponse.json(
          { message: error.message },
          { status: 500 }
        );
      }
      if (!updated) {
        return NextResponse.json(
          { message: "Contact not found." },
          { status: 404 }
        );
      }
      contactId = updated.id as string;
    } else {
      const { data: inserted, error } = await admin
        .from("contacts")
        .insert({
          ...baseFields,
          created_by: user.id,
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error) {
        return NextResponse.json(
          { message: error.message },
          { status: 500 }
        );
      }
      contactId = inserted.id as string;
    }

    const childIds = Array.isArray(child_ids)
      ? (child_ids as string[]).filter((v) => typeof v === "string" && v.length > 0)
      : [];

    await admin.from("contact_children").delete().eq("contact_id", contactId);

    if (childIds.length > 0) {
      const rows = childIds.map((cid) => ({
        contact_id: contactId,
        child_id: cid,
      }));
      const { error: ccError } = await admin
        .from("contact_children")
        .insert(rows);
      if (ccError) {
        return NextResponse.json(
          { message: ccError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ contact_id: contactId });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

