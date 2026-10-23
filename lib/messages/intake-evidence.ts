import type { SupabaseClient } from "@supabase/supabase-js";
import { sageReadsAttachment } from "@/lib/messages/inbound-attachment";
import { mailboxAddress } from "@/lib/messages/mailbox";

export type StoredIntakeDocument = {
  id: string;
  filename: string;
  mimeType: string | null;
  read: boolean;
  visibility: string | null;
  uploadedBy: string | null;
  status: string | null;
};

export type MessageIntakeEvidence = {
  caseId: string | null;
  senderId: string | null;
  senderEmail: string | null;
  senderEmails: string[];
  files: StoredIntakeDocument[];
};

export async function loadMessageIntakeEvidence(
  admin: SupabaseClient,
  messageIds: string[]
): Promise<Map<string, MessageIntakeEvidence>> {
  const evidence = new Map<string, MessageIntakeEvidence>();
  if (messageIds.length === 0) return evidence;
  const { data: messages } = await admin
    .from("messages")
    .select("id, case_id, sender_id, sender_external_email")
    .in("id", messageIds);
  const senderIds = new Set<string>();
  for (const row of messages ?? []) {
    const id = (row as { id?: string }).id;
    if (!id) continue;
    const senderId = ((row as { sender_id?: string | null }).sender_id ?? "").trim() || null;
    const senderEmail =
      ((row as { sender_external_email?: string | null }).sender_external_email ?? "").trim() || null;
    if (senderId) senderIds.add(senderId);
    evidence.set(id, {
      caseId: ((row as { case_id?: string | null }).case_id ?? "").trim() || null,
      senderId,
      senderEmail,
      senderEmails: senderEmail ? [senderEmail] : [],
      files: [],
    });
  }

  if (senderIds.size > 0) {
    const { data: users } = await admin
      .from("users")
      .select("id, email")
      .in("id", [...senderIds]);
    const emailByUser = new Map<string, string>();
    for (const row of users ?? []) {
      const id = (row as { id?: string }).id;
      const email = mailboxAddress((row as { email?: string | null }).email);
      if (id && email) emailByUser.set(id, email);
    }
    for (const source of evidence.values()) {
      const login = source.senderId ? emailByUser.get(source.senderId) : undefined;
      if (login && !source.senderEmails.some((email) => mailboxAddress(email) === login)) {
        source.senderEmails.push(login);
      }
    }
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
  const filesById = new Map<string, StoredIntakeDocument>();
  if (documentIds.length > 0) {
    const { data: docs } = await admin
      .from("documents")
      .select("id, file_name, mime_type, visibility, uploaded_by, status")
      .in("id", documentIds);
    for (const doc of docs ?? []) {
      const id = (doc as { id?: string }).id;
      const filename = ((doc as { file_name?: string | null }).file_name ?? "").trim();
      if (!id || !filename) continue;
      const mime = (doc as { mime_type?: string | null }).mime_type ?? null;
      filesById.set(id, {
        id,
        filename,
        mimeType: mime,
        read: sageReadsAttachment(filename, mime),
        visibility: (doc as { visibility?: string | null }).visibility ?? null,
        uploadedBy: (doc as { uploaded_by?: string | null }).uploaded_by ?? null,
        status: (doc as { status?: string | null }).status ?? null,
      });
    }
  }
  for (const link of links ?? []) {
    const messageId = (link as { message_id?: string }).message_id;
    const documentId = (link as { document_id?: string }).document_id;
    const file = documentId ? filesById.get(documentId) : undefined;
    const target = messageId ? evidence.get(messageId) : undefined;
    if (!target || !file) continue;
    if (!target.files.some((existing) => existing.id === file.id)) {
      target.files.push(file);
    }
  }
  return evidence;
}
