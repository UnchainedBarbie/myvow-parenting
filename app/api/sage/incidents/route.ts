import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

type IncidentSummary = {
  title: string;
  date: string;
  child_id: string | null;
  type: "schedule_issue" | "health_safety" | "communication" | "expense" | "other";
  summary: string;
  notes: string;
};

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
    const { session_id, incident } = body as {
      session_id?: string;
      incident?: IncidentSummary;
    };

    if (!session_id || !incident) {
      return NextResponse.json(
        { message: "Missing session_id or incident payload" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    // Ensure session belongs to user and is an incident session.
    const { data: session, error: sessionError } = await admin
      .from("sage_sessions")
      .select("id, user_id, session_type")
      .eq("id", session_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (sessionError || !session) {
      return NextResponse.json({ message: "Session not found" }, { status: 404 });
    }

    if (session.session_type !== "incident") {
      return NextResponse.json(
        { message: "Only incident sessions can be saved as incident reports." },
        { status: 400 }
      );
    }

    const safeTitle = incident.title?.trim() || "Incident report";
    const safeSummary = incident.summary?.trim() || "";
    const safeNotes = incident.notes?.trim() || "";

    const contentLines = [
      `Title: ${safeTitle}`,
      incident.date ? `Date: ${incident.date}` : null,
      incident.type ? `Type: ${incident.type.replace("_", " ")}` : null,
      incident.child_id ? `Child ID: ${incident.child_id}` : null,
      "",
      "Summary:",
      safeSummary,
      "",
      safeNotes ? "Notes:" : null,
      safeNotes || null,
    ].filter((line) => line != null) as string[];

    const content = contentLines.join("\n");

    const { data: userProfile } = await admin
      .from("users")
      .select("active_case_id")
      .eq("id", user.id)
      .maybeSingle();

    const case_id = (userProfile as { active_case_id?: string | null } | null)
      ?.active_case_id;

    const insertPayload: Record<string, unknown> = {
      case_id: case_id ?? null,
      uploaded_by: user.id,
      title: safeTitle,
      file_name: null,
      file_size_bytes: null,
      mime_type: "text/plain",
      storage_path: null,
      category: "incident",
      child_id: incident.child_id || null,
      description: null,
      content_hash: null,
      visibility: "private",
      ai_processed: false,
      // Optional linkage for future use:
      related_comm_id: session_id,
    };

    const { data: doc, error: docError } = await admin
      .from("documents")
      .insert(insertPayload)
      .select("id")
      .single();

    if (docError || !doc) {
      return NextResponse.json(
        { message: docError?.message ?? "Failed to save incident document." },
        { status: 500 }
      );
    }

    // Mark session as documented.
    const { error: updateSessionError } = await admin
      .from("sage_sessions")
      .update({
        documented: true,
        documented_at: new Date().toISOString(),
      })
      .eq("id", session_id)
      .eq("user_id", user.id);

    if (updateSessionError) {
      // Non-fatal; document exists.
      console.warn(
        "[sage/incidents] Failed to mark session documented:",
        updateSessionError.message
      );
    }

    return NextResponse.json({ document_id: doc.id });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to save incident" },
      { status: 500 }
    );
  }
}

