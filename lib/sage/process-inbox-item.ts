/**
 * Email adapter — runs Observation Builder + Understanding on a stored inbox_items row
 * and writes a sage_items row. No webhook changes; no entity resolution yet.
 */

import { extractPdfText } from "@/lib/pdf-extract";
import { getServiceRoleClient } from "@/lib/supabase/server";
import {
  buildObservation,
  formatObservationForUnderstanding,
  type RawItem,
} from "@/lib/sage/observation-builder";
import { interpret } from "@/lib/sage/understanding";
import type { SupabaseClient } from "@supabase/supabase-js";

const INBOX_BUCKET = "inbox";
const PDF_TYPE = "application/pdf";

export type InboxItemRow = {
  id: string;
  case_id: string;
  source_type: string | null;
  source_email_from: string | null;
  source_email_body: string | null;
  source_email_subject: string | null;
  coparent_email: string | null;
  created_at: string | null;
  raw_content: unknown;
  ai_description: string | null;
  file_name: string | null;
  file_path: string | null;
  mime_type: string | null;
};

export type InboxExtractResult = {
  text: string;
  attachments: { filename: string; text?: string }[];
};

const QUOTED_REPLY_HEADER = /^On .+\s+wrote:\s*$/i;

function isTrivialText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const letters = t.replace(/[^a-zA-Z]/g, "");
  return letters.length < 3;
}

/** Remove quoted-reply headers, ">" lines, and trailing signature/quote blocks. */
export function stripEmailQuoteCruft(raw: string): string {
  if (!raw.trim()) return "";

  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  let sawContent = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (sawContent) {
      if (/^--\s*$/.test(trimmed)) break;
      if (/^_{3,}$/.test(trimmed)) break;
      if (/^Sent from my (iPhone|iPad|Android)/i.test(trimmed)) break;
      if (/^-+\s*Original Message\s*-+$/i.test(trimmed)) break;
      if (/^Begin forwarded message:?$/i.test(trimmed)) break;
    }

    if (QUOTED_REPLY_HEADER.test(trimmed)) break;

    if (trimmed.startsWith(">")) continue;

    if (trimmed) sawContent = true;
    kept.push(line);
  }

  return kept.join("\n").trim();
}

function readRawBody(row: InboxItemRow): string {
  const fromColumn = (row.source_email_body ?? "").trim();
  if (fromColumn) return fromColumn;

  const raw = row.raw_content;
  if (raw && typeof raw === "object" && raw !== null) {
    const text = (raw as { text?: string }).text;
    if (typeof text === "string" && text.trim()) return text.trim();
  }

  return "";
}

function readStoredAttachmentText(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  for (const key of ["extracted_text", "attachment_text", "pdf_text"]) {
    const val = record[key];
    if (typeof val === "string" && val.trim().length > 50) return val.trim();
  }
  return null;
}

async function resolveAttachmentText(
  row: InboxItemRow,
  admin: SupabaseClient
): Promise<{ filename: string; text: string } | null> {
  const filename = (row.file_name ?? "").trim();
  if (!filename) return null;

  const fromRaw = readStoredAttachmentText(row.raw_content);
  if (fromRaw) return { filename, text: fromRaw };

  const filePath = (row.file_path ?? "").trim();
  const mime = (row.mime_type ?? "").trim().toLowerCase();
  const isPdf =
    mime === PDF_TYPE || filename.toLowerCase().endsWith(".pdf");

  if (filePath && isPdf) {
    try {
      const { data, error } = await admin.storage.from(INBOX_BUCKET).download(filePath);
      if (!error && data) {
        const buf = Buffer.from(await data.arrayBuffer());
        const extracted = await extractPdfText(buf);
        if (extracted.trim().length > 0) {
          return { filename, text: extracted.trim() };
        }
      }
    } catch (e) {
      console.error("[process-inbox-item] attachment PDF re-extract failed:", e);
    }
  }

  const description = (row.ai_description ?? "").trim();
  if (description) return { filename, text: description };

  return null;
}

function formatAttachmentBlock(attachment: { filename: string; text: string }): string {
  return `[Attachment: ${attachment.filename}]\n${attachment.text}`;
}

/**
 * Build combined message text and attachment metadata for Understanding.
 * Strips email quote cruft from the body; re-extracts PDF text from storage when needed.
 */
export async function extractInboxText(
  row: InboxItemRow,
  admin: SupabaseClient
): Promise<InboxExtractResult> {
  const strippedBody = stripEmailQuoteCruft(readRawBody(row));
  const usableBody = isTrivialText(strippedBody) ? "" : strippedBody;

  const attachment = await resolveAttachmentText(row, admin);
  const attachments: { filename: string; text?: string }[] = attachment
    ? [{ filename: attachment.filename, text: attachment.text }]
    : [];

  const parts: string[] = [];
  if (usableBody) parts.push(usableBody);
  if (attachment?.text) parts.push(formatAttachmentBlock(attachment));

  if (parts.length > 0) {
    return { text: parts.join("\n\n"), attachments };
  }

  const subject = (row.source_email_subject ?? "").trim();
  const description = (row.ai_description ?? "").trim();
  if (subject && description) {
    return { text: `Subject: ${subject}\n\n${description}`, attachments };
  }
  if (subject) return { text: subject, attachments };
  if (description) return { text: description, attachments };

  return { text: "", attachments };
}

async function resolveVisibleTo(
  caseId: string
): Promise<string | { error: string }> {
  const admin = getServiceRoleClient();
  const { data: members, error } = await admin
    .from("case_members")
    .select("user_id, is_primary")
    .eq("case_id", caseId)
    .not("user_id", "is", null);

  if (error) {
    return { error: `Failed to load case members: ${error.message}` };
  }

  const rows = (members ?? []) as { user_id: string; is_primary: boolean | null }[];
  if (rows.length === 0) {
    return { error: "No case member with a user account found for this case" };
  }

  const primaryMembers = rows.filter((m) => m.is_primary === true);
  if (primaryMembers.length === 1) {
    return primaryMembers[0].user_id;
  }
  if (primaryMembers.length > 1) {
    return {
      error: "Multiple primary case members; cannot determine visible_to unambiguously",
    };
  }

  if (rows.length === 1) {
    return rows[0].user_id;
  }

  return {
    error: "No primary case member; multiple members — cannot determine visible_to unambiguously",
  };
}

export async function processInboxItem(
  inboxItemId: string
): Promise<{ sage_item_id: string } | { error: string }> {
  try {
    const admin = getServiceRoleClient();

    const { data: row, error: fetchError } = await admin
      .from("inbox_items")
      .select(
        "id, case_id, source_type, source_email_from, source_email_body, source_email_subject, coparent_email, created_at, raw_content, ai_description, file_name, file_path, mime_type"
      )
      .eq("id", inboxItemId)
      .maybeSingle();

    if (fetchError) {
      console.error("[process-inbox-item] fetch failed:", fetchError);
      return { error: fetchError.message };
    }
    if (!row) {
      return { error: `inbox_items row not found: ${inboxItemId}` };
    }

    const inboxRow = row as InboxItemRow;
    const extracted = await extractInboxText(inboxRow, admin);
    if (!extracted.text) {
      return {
        error:
          "inbox_items row has no usable email body, attachment text, or subject/description",
      };
    }

    const sourceType = (inboxRow.source_type ?? "email").trim() || "email";
    const sender =
      (inboxRow.source_email_from ?? inboxRow.coparent_email ?? "Co-Parent").trim() ||
      "Co-Parent";

    const rawItem: RawItem = {
      id: inboxRow.id,
      reply_to_id: null,
      from: sender,
      timestamp: inboxRow.created_at ?? new Date().toISOString(),
      text: extracted.text,
      source: sourceType,
      attachments: extracted.attachments.length > 0 ? extracted.attachments : undefined,
    };

    const observation = buildObservation(inboxRow.id, [rawItem]);
    const observationText = formatObservationForUnderstanding(observation);

    const interpretation = await interpret({
      source_type: "email",
      source_id: inboxItemId,
      case_id: inboxRow.case_id,
      sender,
      text: observationText,
      attachments: extracted.attachments.length > 0 ? extracted.attachments : undefined,
    });

    const visibleTo = await resolveVisibleTo(inboxRow.case_id);
    if (typeof visibleTo !== "string") {
      return visibleTo;
    }

    const { intent, entities } = interpretation;

    const { data: sageRow, error: insertError } = await admin
      .from("sage_items")
      .insert({
        case_id: inboxRow.case_id,
        source_type: "email",
        source_id: inboxItemId,
        visible_to: visibleTo,
        item_type: intent.item_type,
        domain: intent.domain,
        summary: intent.summary,
        evidence_excerpt: intent.evidence_excerpt,
        tool_name: intent.tool_name,
        action_required: intent.action_required,
        action_type: intent.action_type,
        urgency: intent.urgency,
        confidence: intent.confidence,
        tool_input: entities,
        child_ids: [],
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !sageRow) {
      console.error("[process-inbox-item] sage_items insert failed:", insertError);
      return { error: insertError?.message ?? "Failed to insert sage_items row" };
    }

    return { sage_item_id: (sageRow as { id: string }).id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "processInboxItem failed";
    console.error("[process-inbox-item]", e);
    return { error: message };
  }
}
