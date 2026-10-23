import type { SupabaseClient } from "@supabase/supabase-js";
import { sageReadsAttachment } from "@/lib/messages/inbound-attachment";

export type MessageIntakeEvidence = {
  senderId: string | null;
  senderEmail: string | null;
  files: { filename: string; read: boolean }[];
};

export async function loadMessageIntakeEvidence(
  admin: SupabaseClient,
  messageIds: string[]
): Promise<Map<string, MessageIntakeEvidence>> {
  const evidence = new Map<string, MessageIntakeEvidence>();
  if (messageIds.length === 0) return evidence;
  const { data: messages } = await admin
    .from("messages")
    .select("id, sender_id, sender_external_email")
    .in("id", messageIds);
  for (const row of messages ?? []) {
    const id = (row as { id?: string }).id;
    if (!id) continue;
    evidence.set(id, {
      senderId: ((row as { sender_id?: string | null }).sender_id ?? "").trim() || null,
      senderEmail: ((row as { sender_external_email?: string | null }).sender_external_email ?? "").trim() || null,
      files: [],
    });
  }

  const { data: links } = await admin
    .from("message_documents")
    .select("message_id, document_id")
    .in("message_id", messageIds);
  const documentIds = [
    ...new Set(
      (links ?? [])
        .map((row) => (row as { document_id?: string }).document_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const filesById = new Map<string, { filename: string; read: boolean }>();
  if (documentIds.length > 0) {
    const { data: docs } = await admin
      .from("documents")
      .select("id, file_name, mime_type")
      .in("id", documentIds);
    for (const doc of docs ?? []) {
      const id = (doc as { id?: string }).id;
      const filename = ((doc as { file_name?: string | null }).file_name ?? "").trim();
      if (!id || !filename) continue;
      const mime = (doc as { mime_type?: string | null }).mime_type ?? null;
      filesById.set(id, { filename, read: sageReadsAttachment(filename, mime) });
    }
  }
  for (const link of links ?? []) {
    const messageId = (link as { message_id?: string }).message_id;
    const documentId = (link as { document_id?: string }).document_id;
    const file = documentId ? filesById.get(documentId) : undefined;
    const target = messageId ? evidence.get(messageId) : undefined;
    if (!target || !file) continue;
    if (!target.files.some((existing) => existing.filename === file.filename)) {
      target.files.push(file);
    }
  }
  return evidence;
}
