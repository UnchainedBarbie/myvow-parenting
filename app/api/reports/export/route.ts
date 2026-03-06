import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import {
  buildMessageTranscriptPdf,
  buildExpenseLedgerPdf,
  buildPatternSummaryPdf,
  buildFullReportPdf,
  sha256Buffer,
  sha256String,
  type MessageRecord,
  type ExpenseRecord,
  type PatternRecord,
} from "@/lib/reports/build-pdf";
import { randomUUID } from "crypto";

const VALID_TYPES = ["messages", "expenses", "patterns", "full_report"] as const;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const {
      case_id,
      export_type,
      date_range_start,
      date_range_end,
    } = body as {
      case_id?: string;
      export_type?: string;
      date_range_start?: string;
      date_range_end?: string;
    };
    if (!case_id || !export_type) {
      return NextResponse.json(
        { message: "Missing case_id or export_type" },
        { status: 400 }
      );
    }
    if (!VALID_TYPES.includes(export_type as (typeof VALID_TYPES)[number])) {
      return NextResponse.json(
        { message: "Invalid export_type" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ message: "Case not found" }, { status: 403 });
    }

    const start = date_range_start || null;
    const end = date_range_end || null;

    let buffer: Buffer;
    let verificationPayload: string;
    let recordCount = 0;

    if (export_type === "messages") {
      let query = admin
        .from("messages")
        .select("id, created_at, direction, original_content, ai_rewritten_content, ai_classification, category")
        .eq("case_id", case_id)
        .order("created_at", { ascending: true });
      if (start) query = query.gte("created_at", start);
      if (end) query = query.lte("created_at", end);
      const { data: messages } = await query;
      const ids = (messages ?? []).map((m) => m.id);
      const { data: flags } =
        ids.length > 0
          ? await admin.from("message_flags").select("message_id, flag_type, description").in("message_id", ids)
          : { data: [] };
      const flagsByMsg: Record<string, { flag_type: string; description: string | null }[]> = {};
      for (const f of flags ?? []) {
        if (!flagsByMsg[f.message_id]) flagsByMsg[f.message_id] = [];
        flagsByMsg[f.message_id].push({ flag_type: f.flag_type, description: f.description });
      }
      const rows: MessageRecord[] = (messages ?? []).map((m) => ({
        id: m.id,
        created_at: m.created_at,
        direction: m.direction,
        original_content: m.original_content,
        ai_rewritten_content: m.ai_rewritten_content,
        ai_classification: m.ai_classification,
        category: m.category,
        flags: flagsByMsg[m.id] ?? [],
      }));
      recordCount = rows.length;
      const result = await buildMessageTranscriptPdf(rows, start, end);
      buffer = result.buffer;
      verificationPayload = result.verificationPayload;
    } else if (export_type === "expenses") {
      let query = admin
        .from("expenses")
        .select("id, created_at, description, amount, category, status, amount_owed")
        .eq("case_id", case_id)
        .order("created_at", { ascending: true });
      if (start) query = query.gte("created_at", start);
      if (end) query = query.lte("created_at", end);
      const { data: expenses } = await query;
      const rows: ExpenseRecord[] = (expenses ?? []).map((e) => ({
        id: e.id,
        created_at: e.created_at,
        description: e.description,
        amount: String(e.amount),
        category: e.category,
        status: e.status,
        amount_owed: e.amount_owed != null ? String(e.amount_owed) : null,
      }));
      recordCount = rows.length;
      const result = await buildExpenseLedgerPdf(rows, start, end);
      buffer = result.buffer;
      verificationPayload = result.verificationPayload;
    } else if (export_type === "patterns") {
      const { data: patterns } = await admin
        .from("pattern_summaries")
        .select("id, flag_type, occurrence_count, first_detected_at, last_detected_at, trend, escalation_score")
        .eq("case_id", case_id);
      const rows: PatternRecord[] = (patterns ?? []).map((p) => ({
        id: p.id,
        flag_type: p.flag_type,
        occurrence_count: p.occurrence_count ?? 0,
        first_detected_at: p.first_detected_at,
        last_detected_at: p.last_detected_at,
        trend: p.trend,
        escalation_score: p.escalation_score != null ? String(p.escalation_score) : null,
      }));
      recordCount = rows.length;
      const result = await buildPatternSummaryPdf(rows, start, end);
      buffer = result.buffer;
      verificationPayload = result.verificationPayload;
    } else {
      let msgQuery = admin.from("messages").select("id, created_at, direction, original_content, ai_rewritten_content, ai_classification, category").eq("case_id", case_id).order("created_at", { ascending: true });
      let expQuery = admin.from("expenses").select("id, created_at, description, amount, category, status, amount_owed").eq("case_id", case_id).order("created_at", { ascending: true });
      if (start) {
        msgQuery = msgQuery.gte("created_at", start);
        expQuery = expQuery.gte("created_at", start);
      }
      if (end) {
        msgQuery = msgQuery.lte("created_at", end);
        expQuery = expQuery.lte("created_at", end);
      }
      const [
        { data: messages },
        { data: expenses },
        { data: patterns },
      ] = await Promise.all([
        msgQuery,
        expQuery,
        admin.from("pattern_summaries").select("id, flag_type, occurrence_count, first_detected_at, last_detected_at, trend, escalation_score").eq("case_id", case_id),
      ]);
      const msgIds = (messages ?? []).map((m) => m.id);
      const { data: flags } = msgIds.length > 0
        ? await admin.from("message_flags").select("message_id, flag_type, description").in("message_id", msgIds)
        : { data: [] };
      const flagsByMsg: Record<string, { flag_type: string; description: string | null }[]> = {};
      for (const f of flags ?? []) {
        if (!flagsByMsg[f.message_id]) flagsByMsg[f.message_id] = [];
        flagsByMsg[f.message_id].push({ flag_type: f.flag_type, description: f.description });
      }
      const msgRows: MessageRecord[] = (messages ?? []).map((m) => ({
        id: m.id,
        created_at: m.created_at,
        direction: m.direction,
        original_content: m.original_content,
        ai_rewritten_content: m.ai_rewritten_content,
        ai_classification: m.ai_classification,
        category: m.category,
        flags: flagsByMsg[m.id] ?? [],
      }));
      const expRows: ExpenseRecord[] = (expenses ?? []).map((e) => ({
        id: e.id,
        created_at: e.created_at,
        description: e.description,
        amount: String(e.amount),
        category: e.category,
        status: e.status,
        amount_owed: e.amount_owed != null ? String(e.amount_owed) : null,
      }));
      const patRows: PatternRecord[] = (patterns ?? []).map((p) => ({
        id: p.id,
        flag_type: p.flag_type,
        occurrence_count: p.occurrence_count ?? 0,
        first_detected_at: p.first_detected_at,
        last_detected_at: p.last_detected_at,
        trend: p.trend,
        escalation_score: p.escalation_score != null ? String(p.escalation_score) : null,
      }));
      recordCount = msgRows.length + expRows.length + patRows.length;
      const result = await buildFullReportPdf(msgRows, expRows, patRows, [], start, end);
      buffer = result.buffer;
      verificationPayload = result.verificationPayload;
    }

    const fileHash = sha256Buffer(buffer);
    const verificationHash = sha256String(verificationPayload);
    const exportId = randomUUID();
    const filePath = `exports/${case_id}/${exportId}.pdf`;

    const { error: uploadError } = await admin.storage
      .from("reports")
      .upload(filePath, buffer, { contentType: "application/pdf", upsert: false });
    if (uploadError) {
      return NextResponse.json(
        { message: uploadError.message || "Upload failed" },
        { status: 500 }
      );
    }

    const { error: insertError } = await admin.from("court_exports").insert({
      id: exportId,
      case_id,
      exported_by: user.id,
      export_type,
      date_range_start: start,
      date_range_end: end,
      file_path: filePath,
      file_hash: fileHash,
      verification_hash: verificationHash,
      record_count: recordCount,
    });
    if (insertError) {
      return NextResponse.json(
        { message: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      export_id: exportId,
      record_count: recordCount,
      verification_hash: verificationHash,
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Export failed" },
      { status: 500 }
    );
  }
}
