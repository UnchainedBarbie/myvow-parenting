import { formatDocumentNumber } from "@/lib/documents-tab";
import { isMissingRelation, recordCategoryLabel } from "@/lib/record/record-categories";
import { renderRecordBody } from "@/lib/record/message-text";
import {
  appliedFilterLines,
  completenessStatement,
  messageMatchesFilters,
  parseRecordFilters,
  resolveDateRange,
  resolveParentSender,
  type RecordFilterInput,
} from "@/lib/record/record-filters";
import {
  conversationHeading,
  deliveryEvidence,
  documentLabel,
  formatDay,
  formatWhen,
  messageNumber,
  messageTime,
  parentIdentities,
  partyLabel,
  safeZone,
  senderCell,
  senderIdentity,
  senderLine,
  zoneOrDenver,
  type Attachment,
  type ConversationRow,
  type MemberRow,
  type MessageRow,
  type RecordEntry,
  type UserRow,
} from "@/lib/record/record-present";
import { documentAuthorizedForViewer } from "@/lib/documents-tab";
import {
  classifyCommunication,
  compareCommunicationRows,
  recipientLabel,
  storedDirection,
  subjectText,
  type CommunicationAttachment,
  type CommunicationRecordModel,
  type CommunicationRow,
  type CommunicationThread,
} from "@/lib/reports/communication-record";
import { getServiceRoleClient } from "@/lib/supabase/server";
import type { SupportingFile } from "@/lib/reports/embed-attachments";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type CommunicationRecordView = {
  caseLabel: string;
  members: MemberRow[];
  usersById: Map<string, UserRow>;
  range: string;
  generatedAt: string;
  timezone: string;
  filters: RecordFilterInput;
  categoryAvailable: boolean;
  filterLines: { label: string; value: string }[];
  shown: RecordEntry[];
  eligibleCount: number;
  notPassed: number;
  threads: { id: string; heading: string; entries: RecordEntry[] }[];
  ungrouped: RecordEntry[];
  attachments: Map<string, Attachment[]>;
};

export type LoadedCommunicationRecord =
  | { ok: false; reason: "denied" | "unavailable" }
  | { ok: true; view: CommunicationRecordView; model: CommunicationRecordModel };

type StoredAttachment = CommunicationAttachment;

export async function loadCommunicationRecord(
  admin: Admin,
  userId: string,
  caseId: string,
  searchParams: Record<string, string | string[] | undefined>
): Promise<LoadedCommunicationRecord> {
  const { data: membership, error: membershipError } = await admin
    .from("case_members")
    .select("id, role")
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (membershipError) {
    console.error("[record] membership", membershipError);
    return { ok: false, reason: "unavailable" };
  }
  if (!membership) return { ok: false, reason: "denied" };
  const viewerRole = (membership as { role?: string | null }).role ?? null;

  const [caseResult, memberResult, viewerResult, messageResult] = await Promise.all([
    admin.from("cases").select("id, family_code").eq("id", caseId).maybeSingle(),
    admin
      .from("case_members")
      .select("id, user_id, display_name, external_email, invited_email, invited_name")
      .eq("case_id", caseId)
      .eq("role", "parent"),
    admin.from("users").select("id, full_name, email, timezone").eq("id", userId).maybeSingle(),
    admin
      .from("messages")
      .select(
        "id, created_at, direction, sender_id, sender_external_email, original_content, conversation_id, current_status, delivery_status, delivered_at, has_attachments, email_message_id"
      )
      .eq("case_id", caseId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (messageResult.error || memberResult.error) {
    console.error("[record] load failed", {
      messages: messageResult.error,
      members: memberResult.error,
    });
    return { ok: false, reason: "unavailable" };
  }
  if (caseResult.error) console.error("[record] case", caseResult.error);

  const members = (memberResult.data ?? []) as MemberRow[];
  const userIds = [
    ...new Set(
      members.map((row) => row.user_id).filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const allMessages = (messageResult.data ?? []) as MessageRow[];
  const senderIds = [
    ...new Set(
      allMessages
        .map((row) => row.sender_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const lookupIds = [...new Set([...userIds, ...senderIds])];
  const userResult =
    lookupIds.length > 0
      ? await admin.from("users").select("id, full_name, email, timezone").in("id", lookupIds)
      : { data: [] as UserRow[], error: null };
  if (userResult.error) console.error("[record] users", userResult.error);
  if (viewerResult.error) console.error("[record] viewer", viewerResult.error);
  const usersById = new Map(((userResult.data ?? []) as UserRow[]).map((row) => [row.id, row]));

  const timezone = safeZone(zoneOrDenver((viewerResult.data as UserRow | null)?.timezone));
  const familyCode = (caseResult.data as { family_code?: string | null } | null)?.family_code?.trim() || "";
  const caseLabel = familyCode || caseId;
  const generated = new Date();
  const filters = parseRecordFilters(searchParams);

  const numbered: RecordEntry[] = allMessages.map((message, index) => ({
    message,
    number: messageNumber(index),
  }));
  const emailIds = [
    ...new Set(
      allMessages
        .map((message) => message.email_message_id?.trim())
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const selfForwardIds = new Set<string>();
  if (emailIds.length > 0) {
    const intake = await admin
      .from("email_intake")
      .select("message_id, branch")
      .eq("case_id", caseId)
      .in("message_id", emailIds);
    if (intake.error) {
      console.error("[record] email_intake", intake.error);
    } else {
      for (const row of intake.data ?? []) {
        const messageId = (row as { message_id?: string | null }).message_id?.trim();
        const branch = (row as { branch?: string | null }).branch;
        if (messageId && branch === "self") selfForwardIds.add(messageId);
      }
    }
  }
  const recipientById = new Map<string, { email: string | null; cc: string | null }>();
  const recipientResult = await admin
    .from("messages")
    .select("id, recipient_email, recipient_cc")
    .eq("case_id", caseId);
  if (recipientResult.error) {
    console.error("[record] recipient columns", recipientResult.error);
  } else {
    for (const row of recipientResult.data ?? []) {
      const id = (row as { id?: string }).id;
      if (!id) continue;
      recipientById.set(id, {
        email: (row as { recipient_email?: string | null }).recipient_email ?? null,
        cc: (row as { recipient_cc?: string | null }).recipient_cc ?? null,
      });
    }
  }
  for (const message of allMessages) {
    const stored = recipientById.get(message.id);
    if (!stored) continue;
    message.recipient_email = stored.email;
    message.recipient_cc = stored.cc;
  }

  let notExchanged = 0;
  const parentIds = parentIdentities(members, usersById, userId);
  const eligible = numbered.filter((entry) => {
    const senderIsParent =
      resolveParentSender(
        { senderId: entry.message.sender_id, senderExternalEmail: entry.message.sender_external_email },
        parentIds
      ) !== null;
    const emailId = entry.message.email_message_id?.trim() ?? "";
    const decision = classifyCommunication({
      status: entry.message.current_status,
      deliveryStatus: entry.message.delivery_status,
      deliveredAt: entry.message.delivered_at,
      senderIsParent,
      selfForward: emailId !== "" && selfForwardIds.has(emailId),
      sageOrJournal: false,
    });
    if (!decision.include) notExchanged += 1;
    return decision.include;
  });
  const unresolvedRecipients = eligible.filter((entry) => {
    const stored = recipientById.get(entry.message.id);
    return !stored?.email?.trim() && !stored?.cc?.trim();
  }).length;

  const { data: conversationRows, error: conversationError } = await admin
    .from("conversations")
    .select("id, topic, category, subject")
    .eq("case_id", caseId);
  if (conversationError) {
    console.error("[record] conversations", conversationError);
    return { ok: false, reason: "unavailable" };
  }
  const conversationsById = new Map<string, ConversationRow>();
  for (const row of (conversationRows ?? []) as ConversationRow[]) {
    if (row.id) conversationsById.set(row.id, row);
  }

  let categoryAvailable = true;
  const categoriesByConversation = new Map<string, Set<string>>();
  const categoryResult = await admin
    .from("conversation_categories")
    .select("conversation_id, category")
    .eq("case_id", caseId);
  if (categoryResult.error && isMissingRelation(categoryResult.error)) {
    categoryAvailable = false;
  } else if (categoryResult.error) {
    console.error("[record] conversation_categories", categoryResult.error);
    if (filters.category) return { ok: false, reason: "unavailable" };
  } else {
    for (const row of categoryResult.data ?? []) {
      const conversationId = (row as { conversation_id?: string }).conversation_id;
      const category = (row as { category?: string }).category;
      if (!conversationId || !category || !recordCategoryLabel(category)) continue;
      const categories = categoriesByConversation.get(conversationId) ?? new Set<string>();
      categories.add(category);
      categoriesByConversation.set(conversationId, categories);
    }
  }

  const attachmentMessageIds = filters.attachmentsOnly
    ? await loadAttachmentMessageIds(
        admin,
        eligible.map((entry) => entry.message.id)
      )
    : new Set<string>();

  const parents = parentIdentities(members, usersById, userId);
  const shown = eligible.filter((entry) =>
    messageMatchesFilters(
      {
        messageId: entry.message.id,
        createdAtMs: messageTime(entry.message.created_at),
        conversationId: entry.message.conversation_id,
        originalContent: entry.message.original_content ?? "",
        senderId: entry.message.sender_id,
        senderExternalEmail: entry.message.sender_external_email,
        hasAttachments: entry.message.has_attachments === true,
      },
      filters,
      {
        timeZone: timezone,
        now: generated,
        conversations: new Map(
          [...conversationsById.entries()].map(([id, row]) => [
            id,
            {
              id,
              subject: row.subject?.trim() ?? "",
              categories: categoriesByConversation.get(id) ?? new Set<string>(),
            },
          ])
        ),
        attachmentMessageIds,
        viewerId: userId,
        parents,
        categoryAvailable,
      }
    )
  );

  const groups = new Map<string, { heading: string; earliest: number; entries: RecordEntry[] }>();
  const ungrouped: RecordEntry[] = [];
  for (const entry of shown) {
    const conversationId = entry.message.conversation_id;
    if (!conversationId) {
      ungrouped.push(entry);
      continue;
    }
    const existing = groups.get(conversationId);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    groups.set(conversationId, {
      heading: conversationHeading(conversationsById.get(conversationId)),
      earliest: messageTime(entry.message.created_at),
      entries: [entry],
    });
  }
  const threads = [...groups.entries()]
    .sort((a, b) => a[1].earliest - b[1].earliest || a[0].localeCompare(b[0]))
    .map(([id, group]) => ({ id, ...group }));

  const richAttachments = await loadRichAttachments(
    admin,
    shown.map((entry) => entry.message.id),
    userId,
    viewerRole
  );
  const attachments = new Map<string, Attachment[]>();
  for (const [messageId, files] of richAttachments) {
    attachments.set(
      messageId,
      files.map((file) => ({ fileName: file.fileName, documentNumber: file.documentNumber }))
    );
  }

  const generatedAt = formatWhen(generated.toISOString(), timezone);
  const selectedConversation = filters.conversationId
    ? conversationsById.get(filters.conversationId)
    : undefined;
  const filterLines = appliedFilterLines(filters, {
    timeZone: timezone,
    now: generated,
    conversationSubject: !filters.conversationId
      ? null
      : selectedConversation
        ? selectedConversation.subject?.trim() || "Untitled conversation"
        : null,
    categoryAvailable,
  });
  const range =
    shown.length === 0
      ? "No messages"
      : (() => {
          const ordered = [...shown].sort(
            (a, b) =>
              messageTime(a.message.created_at) - messageTime(b.message.created_at) ||
              a.message.id.localeCompare(b.message.id)
          );
          const start = formatDay(ordered[0].message.created_at, timezone);
          const end = formatDay(ordered[ordered.length - 1].message.created_at, timezone);
          return start === end ? start : `${start} - ${end}`;
        })();

  const rows = shown
    .map((entry) =>
      toExportRow(entry, {
        conversationsById,
        categoriesByConversation,
        members,
        usersById,
        parents,
        timezone,
        attachments: richAttachments.get(entry.message.id) ?? [],
      })
    )
    .sort(compareCommunicationRows);

  const exportThreads: CommunicationThread[] = threads.map((thread) => ({
    heading: thread.heading,
    rows: thread.entries
      .map((entry) => rows.find((row) => row.id === entry.message.id))
      .filter((row): row is CommunicationRow => Boolean(row)),
  }));
  if (ungrouped.length > 0) {
    exportThreads.push({
      heading: "Ungrouped messages",
      rows: ungrouped
        .map((entry) => rows.find((row) => row.id === entry.message.id))
        .filter((row): row is CommunicationRow => Boolean(row)),
    });
  }

  const period = resolveDateRange(filters, timezone, generated);
  const reportingPeriod = period
    ? filterLines.find((line) => line.label === "Date")?.value || `${period.from} to ${period.to}`
    : "All time";

  const parties = members
    .map((member) => partyLabel(member, member.user_id ? usersById.get(member.user_id) : undefined))
    .filter((label) => label.length > 0);

  const model: CommunicationRecordModel = {
    caseLabel,
    parties,
    timezone,
    generatedAtIso: generated.toISOString(),
    generatedLabel: generatedAt,
    reportingPeriod,
    messageSpan: range,
    filterLines,
    completeness: completenessStatement({
      included: shown.length,
      eligible: eligible.length,
      filteredOut: eligible.length - shown.length,
      notExchanged,
      unresolvedRecipients,
      filtered: filterLines.length > 0,
    }),
    categoryNotice:
      filters.category && !categoryAvailable
        ? "The category filter was not applied because conversation categories are not set up yet."
        : null,
    rows,
    threads: exportThreads,
  };

  return {
    ok: true,
    view: {
      caseLabel,
      members,
      usersById,
      range,
      generatedAt,
      timezone,
      filters,
      categoryAvailable,
      filterLines,
      shown,
      eligibleCount: eligible.length,
      notPassed: allMessages.length - eligible.length,
      threads,
      ungrouped,
      attachments,
    },
    model,
  };
}

function toExportRow(
  entry: RecordEntry,
  context: {
    conversationsById: Map<string, ConversationRow>;
    categoriesByConversation: Map<string, Set<string>>;
    members: MemberRow[];
    usersById: Map<string, UserRow>;
    parents: { userId: string; emails: string[] }[];
    timezone: string;
    attachments: StoredAttachment[];
  }
): CommunicationRow {
  const message = entry.message;
  const sender = senderIdentity(message, context.usersById, context.members);
  const direction = storedDirection(message.direction);
  const directionWord =
    message.direction === "incoming"
      ? "Incoming"
      : message.direction === "outgoing"
        ? "Outgoing"
        : message.direction;
  const conversation = message.conversation_id
    ? context.conversationsById.get(message.conversation_id)
    : undefined;
  const body = renderRecordBody(message.original_content);
  const recipient = recipientLabel({
    recipientEmail: message.recipient_email,
    recipientCc: message.recipient_cc,
  });
  const categories = message.conversation_id
    ? [...(context.categoriesByConversation.get(message.conversation_id) ?? [])]
    : [];
  return {
    id: message.id,
    number: entry.number,
    conversationId: message.conversation_id ?? "",
    subject: subjectText(conversation?.subject),
    threadKey: message.conversation_id ?? "",
    threadHeading: message.conversation_id
      ? conversationHeading(conversation)
      : "Ungrouped messages",
    createdAt: message.created_at,
    deliveredAt: message.delivered_at,
    direction,
    sender: senderCell(sender),
    transcriptWho: senderLine(directionWord, sender),
    recipient,
    body: message.original_content ?? "",
    transcriptText: body.text,
    transcriptOmitted: body.omitted,
    categories,
    attachments: context.attachments,
    deliveryLines: deliveryEvidence(message, context.timezone),
    recordedLabel: formatWhen(message.created_at, context.timezone),
  };
}

async function loadAttachmentMessageIds(admin: Admin, messageIds: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let i = 0; i < messageIds.length; i += 200) {
    const slice = messageIds.slice(i, i + 200);
    const { data, error } = await admin.from("message_documents").select("message_id").in("message_id", slice);
    if (error) {
      console.error("[record] attachment ids", error);
      return ids;
    }
    for (const row of data ?? []) {
      const messageId = (row as { message_id?: string }).message_id;
      if (messageId) ids.add(messageId);
    }
  }
  return ids;
}

async function loadRichAttachments(
  admin: Admin,
  messageIds: string[],
  viewerId: string,
  viewerRole: string | null
): Promise<Map<string, StoredAttachment[]>> {
  const byMessage = new Map<string, StoredAttachment[]>();
  if (messageIds.length === 0) return byMessage;
  const links: { message_id: string; document_id: string }[] = [];
  for (let i = 0; i < messageIds.length; i += 200) {
    const slice = messageIds.slice(i, i + 200);
    const { data, error } = await admin
      .from("message_documents")
      .select("message_id, document_id")
      .in("message_id", slice);
    if (error) {
      console.error("[record] message_documents", error);
      return byMessage;
    }
    for (const row of data ?? []) {
      const messageId = (row as { message_id?: string }).message_id;
      const documentId = (row as { document_id?: string }).document_id;
      if (messageId && documentId) links.push({ message_id: messageId, document_id: documentId });
    }
  }

  const documentIds = [...new Set(links.map((link) => link.document_id))];
  const docs = new Map<string, StoredAttachment>();
  for (let i = 0; i < documentIds.length; i += 200) {
    const slice = documentIds.slice(i, i + 200);
    const full = await admin
      .from("documents")
      .select("id, file_name, document_number, storage_path, mime_type, visibility, uploaded_by")
      .in("id", slice);
    const rows = full.error
      ? (
          await admin.from("documents").select("id, file_name, document_number").in("id", slice)
        ).data
      : full.data;
    if (full.error) console.error("[record] documents", full.error);
    for (const row of rows ?? []) {
      const id = (row as { id?: string }).id;
      const fileName = (row as { file_name?: string | null }).file_name?.trim();
      if (!id || !fileName) continue;
      const documentNumber = (row as { document_number?: number | null }).document_number;
      const visibility = (row as { visibility?: string | null }).visibility ?? null;
      const uploadedBy = (row as { uploaded_by?: string | null }).uploaded_by ?? null;
      docs.set(id, {
        documentId: id,
        fileName,
        documentNumber: typeof documentNumber === "number" ? documentNumber : null,
        label: documentLabel({
          fileName,
          documentNumber: typeof documentNumber === "number" ? documentNumber : null,
        }),
        storagePath: (row as { storage_path?: string | null }).storage_path ?? null,
        mimeType: (row as { mime_type?: string | null }).mime_type ?? null,
        visibility,
        uploadedBy,
        authorized: documentAuthorizedForViewer(
          { visibility, uploadedBy },
          { userId: viewerId, role: viewerRole }
        ),
      });
    }
  }

  for (const link of links) {
    const attachment = docs.get(link.document_id);
    if (!attachment) continue;
    const list = byMessage.get(link.message_id) ?? [];
    list.push(attachment);
    byMessage.set(link.message_id, list);
  }
  for (const list of byMessage.values()) {
    list.sort((a, b) => (a.documentNumber ?? 0) - (b.documentNumber ?? 0) || a.fileName.localeCompare(b.fileName));
  }
  return byMessage;
}

export async function loadCommunicationFiles(
  admin: Admin,
  model: CommunicationRecordModel
): Promise<SupportingFile[]> {
  const ordered: SupportingFile[] = [];
  const index = new Map<string, SupportingFile>();
  for (const row of model.rows) {
    for (const attachment of row.attachments) {
      if (!attachment.authorized) continue;
      const existing = index.get(attachment.documentId);
      if (existing) {
        if (!existing.records.includes(row.number)) existing.records.push(row.number);
        continue;
      }
      let bytes: Buffer | null = null;
      let unavailableReason: string | null = null;
      if (!attachment.storagePath) {
        unavailableReason = "No stored file is available.";
      } else {
        const downloaded = await admin.storage.from("documents").download(attachment.storagePath);
        if (downloaded.error || !downloaded.data) {
          unavailableReason = "The stored file could not be downloaded.";
        } else {
          bytes = Buffer.from(await downloaded.data.arrayBuffer());
        }
      }
      const numberLabel = formatDocumentNumber(attachment.documentNumber);
      const file: SupportingFile = {
        key: attachment.documentId,
        records: [row.number],
        documentLabel: numberLabel === "—" ? null : numberLabel,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        bytes,
        unavailableReason,
      };
      index.set(attachment.documentId, file);
      ordered.push(file);
    }
  }
  return ordered;
}
