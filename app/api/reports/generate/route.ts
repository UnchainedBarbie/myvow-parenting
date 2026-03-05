import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import {
  buildMessageTranscriptPdf,
  buildExpenseLedgerPdf,
  buildFullReportPdf,
  sha256Buffer,
  sha256String,
  type MessageRecord,
  type ExpenseRecord,
} from "@/lib/reports/build-pdf";
import { jsPDF } from "jspdf";
import { randomUUID } from "crypto";

const REPORT_TYPES = [
  "communication_report",
  "expense_report",
  "calendar_report",
  "document_index",
  "full_case_report",
] as const;

function getBuffer(doc: jsPDF): Buffer {
  const out = doc.output("arraybuffer");
  return Buffer.from(new Uint8Array(out as ArrayBuffer));
}

function buildPlaceholderPdf(title: string, body: string): Buffer {
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text("MyVow Parenting — Court-Ready Export", 20, 20);
  doc.setFontSize(12);
  doc.text(title, 20, 28);
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(body, 170);
  doc.text(lines, 20, 38);
  return getBuffer(doc);
}

function buildExpenseCsv(expenses: ExpenseRecord[]): string {
  const headers = [
    "Date",
    "Description",
    "Category",
    "Amount",
    "Status",
    "Amount Owed",
  ];
  const rows = expenses.map((e) => [
    new Date(e.created_at).toLocaleDateString(),
    (e.description ?? "").replace(/"/g, '""'),
    e.category ?? "",
    e.amount ?? "",
    e.status ?? "",
    e.amount_owed ?? "",
  ].map((c) => `"${String(c)}"`).join(","));
  return [headers.join(","), ...rows].join("\r\n");
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
    const {
      case_id,
      report_type,
      format,
      date_range_start,
      date_range_end,
      options,
    } = body as {
      case_id?: string;
      report_type?: string;
      format?: string;
      date_range_start?: string;
      date_range_end?: string;
      options?: Record<string, boolean>;
    };

    if (!case_id || !report_type) {
      return NextResponse.json(
        { message: "Missing case_id or report_type" },
        { status: 400 }
      );
    }

    if (!REPORT_TYPES.includes(report_type as (typeof REPORT_TYPES)[number])) {
      return NextResponse.json(
        { message: "Invalid report_type" },
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
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const start = date_range_start ?? null;
    const end = date_range_end ?? null;
    const exportId = randomUUID();
    let buffer: Buffer;
    let verificationPayload: string;
    let recordCount = 0;
    let contentType = "application/pdf";
    let fileExt = "pdf";

    if (report_type === "communication_report") {
      let query = admin
        .from("messages")
        .select("id, conversation_id, created_at, direction, original_content, ai_rewritten_content, ai_classification, category")
        .eq("case_id", case_id)
        .order("created_at", { ascending: true });
      if (start) query = query.gte("created_at", start);
      if (end) query = query.lte("created_at", end);
      const { data: messages } = await query;
      const ids = (messages ?? []).map((m) => m.id);
      const convIds = [...new Set((messages ?? []).map((m) => (m as { conversation_id?: string | null }).conversation_id).filter(Boolean) as string[])];
      const topicByConv: Record<string, string> = {};
      if (convIds.length > 0) {
        const { data: convs } = await admin.from("conversations").select("id, topic, category").in("id", convIds);
        for (const c of convs ?? []) {
          const tag = (c as { topic?: string | null; category?: string | null }).topic ?? (c as { category?: string | null }).category;
          if (tag) topicByConv[c.id as string] = tag;
        }
      }
      const { data: flags } =
        ids.length > 0
          ? await admin.from("message_flags").select("message_id, flag_type, description").in("message_id", ids)
          : { data: [] };
      const flagsByMsg: Record<string, { flag_type: string; description: string | null }[]> = {};
      for (const f of flags ?? []) {
        if (!flagsByMsg[f.message_id]) flagsByMsg[f.message_id] = [];
        flagsByMsg[f.message_id].push({ flag_type: f.flag_type, description: f.description });
      }
      const topicLabels: Record<string, string> = { medical: "Medical", school: "School", schedule: "Schedule", expenses: "Expenses", general: "General", emergency: "Emergency", expense: "Expenses" };
      const rows: MessageRecord[] = (messages ?? []).map((m) => {
        const convId = (m as { conversation_id?: string | null }).conversation_id;
        const rawTopic = convId ? topicByConv[convId] : null;
        const conversation_topic = rawTopic ? (topicLabels[rawTopic] ?? rawTopic) : null;
        return {
          id: m.id,
          created_at: m.created_at,
          direction: m.direction,
          original_content: m.original_content,
          ai_rewritten_content: m.ai_rewritten_content,
          ai_classification: m.ai_classification,
          category: m.category,
          conversation_topic,
          flags: flagsByMsg[m.id] ?? [],
        };
      });
      recordCount = rows.length;
      const result = await buildMessageTranscriptPdf(rows, start, end);
      buffer = result.buffer;
      verificationPayload = result.verificationPayload;
    } else if (report_type === "expense_report") {
      let query = admin
        .from("expenses")
        .select("id, created_at, description, amount, category, status, amount_owed")
        .eq("case_id", case_id)
        .is("deleted_at", null)
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

      if (format === "csv") {
        const csv = buildExpenseCsv(rows);
        buffer = Buffer.from("\uFEFF" + csv, "utf-8");
        verificationPayload = csv;
        contentType = "text/csv";
        fileExt = "csv";
      } else {
        const result = await buildExpenseLedgerPdf(rows, start, end);
        buffer = result.buffer;
        verificationPayload = result.verificationPayload;
      }
    } else if (report_type === "calendar_report") {
      const pdf = buildPlaceholderPdf(
        "Calendar & Custody Report",
        "This report type is in development. Custody schedule, schedule changes, and calendar events by child will be included in a future update."
      );
      buffer = pdf;
      verificationPayload = "calendar_report_placeholder";
      recordCount = 0;
    } else if (report_type === "document_index") {
      const pdf = buildPlaceholderPdf(
        "Document Index",
        "This report type is in development. Document list with categories, dates, and linked conversations will be included in a future update."
      );
      buffer = pdf;
      verificationPayload = "document_index_placeholder";
      recordCount = 0;
    } else {
      // full_case_report
      let msgQuery = admin
        .from("messages")
        .select("id, conversation_id, created_at, direction, original_content, ai_rewritten_content, ai_classification, category")
        .eq("case_id", case_id)
        .order("created_at", { ascending: true });
      let expQuery = admin
        .from("expenses")
        .select("id, created_at, description, amount, category, status, amount_owed")
        .eq("case_id", case_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (start) {
        msgQuery = msgQuery.gte("created_at", start);
        expQuery = expQuery.gte("created_at", start);
      }
      if (end) {
        msgQuery = msgQuery.lte("created_at", end);
        expQuery = expQuery.lte("created_at", end);
      }
      const [{ data: messages }, { data: expenses }] = await Promise.all([msgQuery, expQuery]);
      const msgIds = (messages ?? []).map((m) => m.id);
      const { data: flags } =
        msgIds.length > 0
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
      recordCount = msgRows.length + expRows.length;
      const result = await buildFullReportPdf(msgRows, expRows, [], start, end);
      buffer = result.buffer;
      verificationPayload = result.verificationPayload;
    }

    const fileHash = sha256Buffer(buffer);
    const verificationHash = sha256String(verificationPayload);
    const filePath = `exports/${case_id}/${exportId}.${fileExt}`;

    const { error: uploadError } = await admin.storage
      .from("reports")
      .upload(filePath, buffer, { contentType, upsert: false });

    if (uploadError) {
      return NextResponse.json(
        { message: uploadError.message ?? "Upload failed" },
        { status: 500 }
      );
    }

    const { error: insertError } = await admin.from("court_exports").insert({
      id: exportId,
      case_id,
      exported_by: user.id,
      export_type: report_type,
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
      { message: e instanceof Error ? e.message : "Report generation failed" },
      { status: 500 }
    );
  }
}
