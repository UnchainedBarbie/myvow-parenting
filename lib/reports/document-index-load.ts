import { getServiceRoleClient } from "@/lib/supabase/server";
import { documentAuthorizedForViewer, formatDocumentNumber } from "@/lib/documents-tab";
import { loadVisibleExpenses } from "@/lib/expenses-visibility";
import {
  classifySupportingFile,
  supportingFileSentence,
  type SupportingFile,
} from "@/lib/reports/embed-attachments";
import type { DocumentIndexOptions, DocumentIndexSource } from "@/lib/reports/document-index";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type DocumentIndexLoad = {
  documents: DocumentIndexSource[];
  parents: { name: string }[];
  caseLabel: string;
  timeZone: string;
  withheldCount: number;
  fileLines: string[];
  linkWarning: string | null;
  files: SupportingFile[];
};

const DEFAULT_TIMEZONE = "America/Denver";

function safeZone(timeZone: string | null | undefined): string {
  const trimmed = timeZone?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function partyName(
  member: {
    display_name?: string | null;
    invited_name?: string | null;
    external_email?: string | null;
    invited_email?: string | null;
  },
  user: { full_name?: string | null; email?: string | null } | undefined
): string {
  const name = member.display_name?.trim() || member.invited_name?.trim() || user?.full_name?.trim() || "";
  const email = member.external_email?.trim() || member.invited_email?.trim() || user?.email?.trim() || "";
  if (name && email) return `${name} (${email})`;
  return name || email;
}

function missingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(message);
}

type RawDocument = {
  id: string;
  title?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  category?: string | null;
  created_at?: string | null;
  visibility?: string | null;
  document_number?: number | null;
  uploaded_by?: string | null;
  related_comm_id?: string | null;
  storage_path?: string | null;
};

export async function loadDocumentIndex(input: {
  admin: Admin;
  caseId: string;
  userId: string;
  options: DocumentIndexOptions;
}): Promise<DocumentIndexLoad> {
  const { admin, caseId, userId } = input;
  const [caseResult, memberResult, viewerResult, viewerMemberResult, documentResult] = await Promise.all([
    admin.from("cases").select("id, family_code").eq("id", caseId).maybeSingle(),
    admin
      .from("case_members")
      .select("user_id, role, display_name, invited_name, external_email, invited_email")
      .eq("case_id", caseId)
      .eq("role", "parent"),
    admin.from("users").select("id, full_name, email, timezone").eq("id", userId).maybeSingle(),
    admin.from("case_members").select("role").eq("case_id", caseId).eq("user_id", userId).maybeSingle(),
    admin
      .from("documents")
      .select(
        "id, title, file_name, mime_type, category, created_at, visibility, document_number, uploaded_by, related_comm_id, storage_path"
      )
      .eq("case_id", caseId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (documentResult.error) throw new Error(documentResult.error.message);

  const role = (viewerMemberResult.data as { role?: string | null } | null)?.role ?? null;
  const raw = (documentResult.data ?? []) as RawDocument[];
  const visible = raw.filter((doc) =>
    documentAuthorizedForViewer({ visibility: doc.visibility, uploadedBy: doc.uploaded_by }, { userId, role })
  );
  const withheldCount = raw.length - visible.length;
  const visibleIds = visible.map((doc) => doc.id);

  const childNameByDocument = new Map<string, string>();
  if (visibleIds.length > 0) {
    const { data: links } = await admin
      .from("document_children")
      .select("document_id, child_id")
      .in("document_id", visibleIds);
    const childIds = [
      ...new Set(
        (links ?? [])
          .map((row) => (row as { child_id?: string }).child_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];
    const { data: children } =
      childIds.length > 0
        ? await admin.from("children").select("id, first_name").in("id", childIds)
        : { data: [] as { id: string; first_name?: string | null }[] };
    const names = new Map(
      ((children ?? []) as { id: string; first_name?: string | null }[]).map((child) => [
        child.id,
        child.first_name?.trim() || "Unnamed child",
      ])
    );
    const grouped = new Map<string, string[]>();
    for (const link of links ?? []) {
      const documentId = (link as { document_id?: string }).document_id;
      const childId = (link as { child_id?: string }).child_id;
      if (!documentId || !childId) continue;
      const list = grouped.get(documentId) ?? [];
      list.push(names.get(childId) ?? "Unnamed child");
      grouped.set(documentId, list);
    }
    for (const [documentId, list] of grouped) childNameByDocument.set(documentId, list.join(", "));
  }

  let linkWarning: string | null = null;
  const conversationsByDocument = new Map<string, Set<string>>();
  const addConversation = (documentId: string, label: string) => {
    const trimmed = label.trim();
    if (!documentId || !trimmed) return;
    const set = conversationsByDocument.get(documentId) ?? new Set<string>();
    set.add(trimmed);
    conversationsByDocument.set(documentId, set);
  };

  if (input.options.linkedConversations && visibleIds.length > 0) {
    const conversationIds = new Set<string>();
    const documentIdsByConversation = new Map<string, Set<string>>();
    const remember = (documentId: string, conversationId: string) => {
      if (!documentId || !conversationId) return;
      conversationIds.add(conversationId);
      const set = documentIdsByConversation.get(conversationId) ?? new Set<string>();
      set.add(documentId);
      documentIdsByConversation.set(conversationId, set);
    };

    const attachmentResult = await admin
      .from("conversation_attachments")
      .select("attachment_id, conversation_id")
      .eq("attachment_type", "document")
      .in("attachment_id", visibleIds);
    if (attachmentResult.error) {
      if (missingRelation(attachmentResult.error)) {
        linkWarning = "Linked conversation records could not be read, so conversation names may be incomplete.";
      } else {
        throw new Error(attachmentResult.error.message);
      }
    } else {
      for (const row of attachmentResult.data ?? []) {
        const documentId = (row as { attachment_id?: string }).attachment_id;
        const conversationId = (row as { conversation_id?: string }).conversation_id;
        if (documentId && conversationId) remember(documentId, conversationId);
      }
    }

    const messageLinkResult = await admin
      .from("message_documents")
      .select("document_id, message_id")
      .in("document_id", visibleIds);
    const messageIds = new Set<string>();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (messageLinkResult.error) {
      if (missingRelation(messageLinkResult.error)) {
        linkWarning = "Linked conversation records could not be read, so conversation names may be incomplete.";
      } else {
        throw new Error(messageLinkResult.error.message);
      }
    } else {
      for (const row of messageLinkResult.data ?? []) {
        const messageId = (row as { message_id?: string }).message_id;
        if (messageId) messageIds.add(messageId);
      }
    }

    const relatedValues = [
      ...new Set(
        visible
          .map((doc) => doc.related_comm_id?.trim() ?? "")
          .filter((value) => value.length > 0)
      ),
    ];
    for (const value of relatedValues) {
      if (uuidPattern.test(value)) messageIds.add(value);
    }

    const messageToDocuments = new Map<string, Set<string>>();
    if (!messageLinkResult.error) {
      for (const row of messageLinkResult.data ?? []) {
        const documentId = (row as { document_id?: string }).document_id;
        const messageId = (row as { message_id?: string }).message_id;
        if (!documentId || !messageId) continue;
        const set = messageToDocuments.get(messageId) ?? new Set<string>();
        set.add(documentId);
        messageToDocuments.set(messageId, set);
      }
    }
    for (const doc of visible) {
      const related = doc.related_comm_id?.trim();
      if (!related) continue;
      const set = messageToDocuments.get(related) ?? new Set<string>();
      set.add(doc.id);
      messageToDocuments.set(related, set);
    }

    if (messageIds.size > 0 || relatedValues.length > 0) {
      const ids = [...messageIds];
      const messageResult =
        ids.length > 0
          ? await admin
              .from("messages")
              .select("id, conversation_id, external_comm_id")
              .eq("case_id", caseId)
              .in("id", ids)
          : { data: [] as { id: string; conversation_id?: string | null; external_comm_id?: string | null }[], error: null };
      if (messageResult.error) throw new Error(messageResult.error.message);
      const externalResult =
        relatedValues.length > 0
          ? await admin
              .from("messages")
              .select("id, conversation_id, external_comm_id")
              .eq("case_id", caseId)
              .in("external_comm_id", relatedValues)
          : { data: [] as { id: string; conversation_id?: string | null; external_comm_id?: string | null }[], error: null };
      if (externalResult.error && !missingRelation(externalResult.error)) {
        throw new Error(externalResult.error.message);
      }
      const messages = [
        ...((messageResult.data ?? []) as { id: string; conversation_id?: string | null; external_comm_id?: string | null }[]),
        ...((externalResult.error ? [] : externalResult.data ?? []) as {
          id: string;
          conversation_id?: string | null;
          external_comm_id?: string | null;
        }[]),
      ];
      for (const message of messages) {
        if (!message.conversation_id) continue;
        const keys = [message.id, message.external_comm_id?.trim() ?? ""].filter(Boolean);
        for (const key of keys) {
          const docs = messageToDocuments.get(key);
          if (!docs) continue;
          for (const documentId of docs) remember(documentId, message.conversation_id);
        }
      }
    }

    for (const value of relatedValues) {
      if (uuidPattern.test(value)) conversationIds.add(value);
    }
    for (const doc of visible) {
      const related = doc.related_comm_id?.trim() ?? "";
      if (uuidPattern.test(related)) {
        const set = documentIdsByConversation.get(related) ?? new Set<string>();
        set.add(doc.id);
        documentIdsByConversation.set(related, set);
      }
    }

    if (conversationIds.size > 0) {
      const { data: conversations, error } = await admin
        .from("conversations")
        .select("id, subject")
        .eq("case_id", caseId)
        .in("id", [...conversationIds]);
      if (error) throw new Error(error.message);
      for (const conversation of conversations ?? []) {
        const id = (conversation as { id: string }).id;
        const subject = (conversation as { subject?: string | null }).subject?.trim() || "Untitled conversation";
        const docs = documentIdsByConversation.get(id);
        if (!docs) continue;
        for (const documentId of docs) addConversation(documentId, subject);
      }
    }
  }

  const uploaderIds = [
    ...new Set(
      visible
        .map((doc) => doc.uploaded_by)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const uploaderResult =
    uploaderIds.length > 0
      ? await admin.from("users").select("id, full_name, email").in("id", uploaderIds)
      : { data: [] as { id: string; full_name?: string | null; email?: string | null }[] };
  const uploaderNames = new Map(
    ((uploaderResult.data ?? []) as { id: string; full_name?: string | null; email?: string | null }[]).map((user) => [
      user.id,
      user.full_name?.trim() || user.email?.trim() || "",
    ])
  );
  const linkedExpenses = new Map<string, string[]>();
  const linkedMessages = new Map<string, string[]>();
  if (visibleIds.length > 0) {
    const expenseLinks = await loadVisibleExpenses(
      (columns) =>
        admin
          .from("expenses")
          .select(columns)
          .eq("case_id", caseId)
          .is("deleted_at", null)
          .in("receipt_file_id", visibleIds),
      "expense_number, receipt_file_id",
      { userId, role }
    );
    if (!expenseLinks.error) {
      for (const row of expenseLinks.rows) {
        const documentId = (row as { receipt_file_id?: string | null }).receipt_file_id;
        const number = (row as { expense_number?: number | null }).expense_number;
        if (!documentId || typeof number !== "number") continue;
        const list = linkedExpenses.get(documentId) ?? [];
        list.push(`EXP-${String(number).padStart(3, "0")}`);
        linkedExpenses.set(documentId, list);
      }
    }
    const messageLinks = await admin
      .from("message_documents")
      .select("document_id, message_id")
      .in("document_id", visibleIds);
    if (!messageLinks.error) {
      for (const row of messageLinks.data ?? []) {
        const documentId = (row as { document_id?: string }).document_id;
        const messageId = (row as { message_id?: string }).message_id;
        if (!documentId || !messageId) continue;
        const list = linkedMessages.get(documentId) ?? [];
        if (!list.includes("Message link stored")) list.push("Message link stored");
        linkedMessages.set(documentId, list);
      }
    }
  }

  const documents: DocumentIndexSource[] = visible.map((doc) => ({
    id: doc.id,
    documentNumber: typeof doc.document_number === "number" ? doc.document_number : null,
    title: doc.title ?? null,
    fileName: doc.file_name?.trim() || "Untitled file",
    category: doc.category ?? "",
    childName: childNameByDocument.get(doc.id) || "All children",
    createdAt: doc.created_at ?? "",
    visibility: doc.visibility ?? "private",
    conversations: [...(conversationsByDocument.get(doc.id) ?? [])].sort((a, b) => a.localeCompare(b)),
    uploadedByName: doc.uploaded_by ? uploaderNames.get(doc.uploaded_by) || null : null,
    linkedExpenses: linkedExpenses.get(doc.id) ?? [],
    linkedMessages: [
      ...new Set([
        ...(doc.related_comm_id?.trim() ? ["Message link stored"] : []),
        ...(linkedMessages.get(doc.id) ?? []),
      ]),
    ],
    hasStoredFile: Boolean(doc.storage_path?.trim()),
  }));

  const files: SupportingFile[] = [];
  const fileLines: string[] = [];
  if (input.options.includeFiles) {
    const ordered = [...documents].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
    for (const doc of ordered) {
      const rawDoc = visible.find((item) => item.id === doc.id);
      const record = formatDocumentNumber(doc.documentNumber);
      const supports = [record === "—" ? doc.id : record, ...doc.linkedExpenses];
      const file: SupportingFile = {
        key: doc.id,
        records: supports,
        documentLabel: record === "—" ? null : record,
        fileName: doc.fileName,
        mimeType: rawDoc?.mime_type ?? null,
        bytes: null,
        unavailableReason: null,
      };
      const path = rawDoc?.storage_path?.trim();
      if (!path) {
        file.unavailableReason = "No file is stored for this document.";
      } else {
        const { data, error } = await admin.storage.from("documents").download(path);
        if (error || !data) {
          file.unavailableReason = "The file could not be downloaded.";
        } else {
          file.bytes = Buffer.from(await data.arrayBuffer());
        }
      }
      const disposition = await classifySupportingFile(file);
      fileLines.push(supportingFileSentence(file, disposition));
      files.push(file);
    }
  }

  const members = (memberResult.data ?? []) as {
    user_id?: string | null;
    display_name?: string | null;
    invited_name?: string | null;
    external_email?: string | null;
    invited_email?: string | null;
  }[];
  const userIds = members.map((member) => member.user_id).filter((id): id is string => Boolean(id));
  const userRows =
    userIds.length > 0
      ? await admin.from("users").select("id, full_name, email").in("id", userIds)
      : { data: [] as { id: string; full_name?: string | null; email?: string | null }[] };
  const users = new Map(
    ((userRows.data ?? []) as { id: string; full_name?: string | null; email?: string | null }[]).map((user) => [
      user.id,
      user,
    ])
  );
  const familyCode = (caseResult.data as { family_code?: string | null } | null)?.family_code?.trim() || "";

  return {
    documents,
    parents: members.map((member) => ({
      name: partyName(member, member.user_id ? users.get(member.user_id) : undefined),
    })),
    caseLabel: familyCode || caseId,
    timeZone: safeZone((viewerResult.data as { timezone?: string | null } | null)?.timezone),
    withheldCount,
    fileLines,
    linkWarning,
    files,
  };
}
