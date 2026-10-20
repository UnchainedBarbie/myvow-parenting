import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { renderRecordBody } from "@/lib/record/message-text";
import { PrintRecordButton } from "./print-record-button";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MemberRow = {
  id: string;
  user_id: string | null;
  display_name: string | null;
  external_email: string | null;
  invited_email: string | null;
  invited_name: string | null;
};

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  timezone: string | null;
};

type MessageRow = {
  id: string;
  created_at: string;
  direction: string;
  sender_id: string | null;
  sender_external_email: string | null;
  original_content: string | null;
  conversation_id: string | null;
  current_status: string | null;
  delivery_status: string | null;
  delivered_at: string | null;
};

type ConversationRow = {
  id: string;
  topic: string | null;
  category: string | null;
  subject: string | null;
};

type RecordEntry = {
  message: MessageRow;
  number: string;
};

type Attachment = {
  fileName: string;
  documentNumber: number | null;
};

const NOT_PASSED = new Set([
  "draft",
  "pending",
  "pending_approval",
  "ai_processing",
  "failed",
]);

function cssString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/</g, "")
    .replace(/[\r\n]+/g, " ");
}

const DEFAULT_TIMEZONE = "America/Denver";

function zoneOrDenver(timezone: string | null | undefined): string {
  const trimmed = timezone?.trim();
  return trimmed ? trimmed : DEFAULT_TIMEZONE;
}

function formatWhen(iso: string, timezone: string | null | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: zoneOrDenver(timezone),
  }).format(date);
}

function formatDay(iso: string, timezone: string | null | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: zoneOrDenver(timezone),
  }).format(date);
}

function passedBetweenParents(message: MessageRow): boolean {
  const status = (message.current_status ?? "").toLowerCase();
  if (NOT_PASSED.has(status)) return false;
  const delivery = (message.delivery_status ?? "").toLowerCase();
  if (delivery === "pending" || delivery === "buffered" || delivery === "blocked") return false;
  if (delivery === "delivered" || message.delivered_at != null) return true;
  return (
    status === "sent" ||
    status === "received" ||
    status === "delivered" ||
    status === "approved"
  );
}

function deliveryStatusWords(status: string): string | null {
  switch (status.trim().toLowerCase()) {
    case "delivered":
      return "Delivered";
    case "pending":
      return "Pending delivery";
    case "buffered":
      return "Held before delivery";
    case "blocked":
      return "Blocked";
    default:
      return null;
  }
}

function deliveryEvidence(message: MessageRow, timezone: string): string[] {
  const direction = (message.direction ?? "").trim().toLowerCase();
  if (direction === "incoming") {
    if (!message.current_status?.trim() && !message.delivery_status?.trim()) return [];
    return ["Received"];
  }
  const lines: string[] = [];
  const status = message.delivery_status?.trim() ?? "";
  const deliveredAt = message.delivered_at?.trim() ?? "";
  const words = status ? deliveryStatusWords(status) : null;
  if (deliveredAt) {
    lines.push(`Delivered ${formatWhen(deliveredAt, timezone)}`);
  } else if (words) {
    lines.push(words);
  }
  if (deliveredAt && words && status.toLowerCase() !== "delivered") {
    lines.unshift(words);
  }
  return lines;
}

function completenessStatement(included: number, excluded: number): string {
  const includedText = `${included} message${included === 1 ? " is" : "s are"} included.`;
  const excludedText = `${excluded} message${excluded === 1 ? " is" : "s are"} excluded`;
  if (excluded === 0) {
    return `This is the complete record of messages in this case. ${includedText} ${excludedText}.`;
  }
  return `This is a filtered view, not the complete record of the case. ${includedText} ${excludedText} because ${excluded === 1 ? "it" : "they"} did not pass between the parents. Excluded messages retain their numbers.`;
}

function messageNumber(index: number): string {
  return `MSG-${String(index + 1).padStart(3, "0")}`;
}

function documentLabel(attachment: Attachment): string {
  if (attachment.documentNumber == null) return attachment.fileName;
  return `${attachment.fileName} (DOC-${String(attachment.documentNumber).padStart(3, "0")})`;
}

const TOPIC_LABELS: Record<string, string> = {
  medical: "Medical",
  school: "School",
  schedule: "Schedule",
  expenses: "Expenses",
  expense: "Expenses",
  general: "General",
  emergency: "Emergency",
};

function storedName(member: MemberRow | undefined, user: UserRow | undefined): string {
  return (
    member?.display_name?.trim() ||
    member?.invited_name?.trim() ||
    user?.full_name?.trim() ||
    ""
  );
}

function storedEmail(member: MemberRow | undefined, user: UserRow | undefined): string {
  return (
    member?.external_email?.trim() ||
    member?.invited_email?.trim() ||
    user?.email?.trim() ||
    ""
  );
}

function partyLabel(member: MemberRow, user: UserRow | undefined): string {
  const name = storedName(member, user);
  const email = storedEmail(member, user);
  if (name && email) return `${name} (${email})`;
  return name || email;
}

function senderIdentity(
  message: MessageRow,
  usersById: Map<string, UserRow>,
  members: MemberRow[]
): { name: string; email: string } {
  if (message.sender_id) {
    const user = usersById.get(message.sender_id);
    const member = members.find((row) => row.user_id === message.sender_id);
    return {
      name: storedName(member, user),
      email: user?.email?.trim() || storedEmail(member, undefined),
    };
  }
  const email = message.sender_external_email?.trim() || "";
  const member = members.find((row) => {
    const stored = (row.external_email || row.invited_email || "").trim().toLowerCase();
    return email !== "" && stored === email.toLowerCase();
  });
  return {
    name: storedName(member, undefined),
    email,
  };
}

function senderLine(direction: string, sender: { name: string; email: string }): string {
  const name = sender.name.trim();
  const email = sender.email.trim();
  if (name && email && name.toLowerCase() !== email.toLowerCase()) {
    return `${direction}, sent by ${name} (${email})`;
  }
  const who = name || email;
  return who ? `${direction}, sent by ${who}` : direction;
}

function conversationHeading(conversation: ConversationRow | undefined): string {
  const subject = conversation?.subject?.trim() || "";
  if (subject) return subject;
  const raw = conversation?.topic?.trim() || conversation?.category?.trim() || "";
  if (raw) return TOPIC_LABELS[raw.toLowerCase()] ?? raw;
  return "Conversation";
}

function messageTime(iso: string): number {
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export default async function CaseRecordPage({
  params,
}: {
  params: { caseId: string };
}) {
  const caseId = params.caseId;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!UUID_RE.test(caseId)) {
    return <Denied />;
  }

  const admin = getServiceRoleClient();
  try {
    return await renderRecord(admin, user.id, caseId);
  } catch (error) {
    console.error("[record]", error);
    return <Unavailable />;
  }
}

async function renderRecord(
  admin: ReturnType<typeof getServiceRoleClient>,
  userId: string,
  caseId: string
) {
  const { data: membership, error: membershipError } = await admin
    .from("case_members")
    .select("id")
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .maybeSingle();

  if (membershipError) {
    console.error("[record] membership", membershipError);
    return <Unavailable />;
  }
  if (!membership) {
    return <Denied />;
  }

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
        "id, created_at, direction, sender_id, sender_external_email, original_content, conversation_id, current_status, delivery_status, delivered_at"
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
    return <Unavailable />;
  }
  if (caseResult.error) {
    console.error("[record] case", caseResult.error);
  }

  const caseRow = caseResult.data;
  const memberRows = memberResult.data;
  const viewerRow = viewerResult.data;
  const messageRows = messageResult.data;

  const members = (memberRows ?? []) as MemberRow[];
  const userIds = [
    ...new Set(
      members
        .map((row) => row.user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const senderIds = [
    ...new Set(
      ((messageRows ?? []) as MessageRow[])
        .map((row) => row.sender_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const lookupIds = [...new Set([...userIds, ...senderIds])];
  const userResult =
    lookupIds.length > 0
      ? await admin.from("users").select("id, full_name, email, timezone").in("id", lookupIds)
      : { data: [] as UserRow[], error: null };
  if (userResult.error) {
    console.error("[record] users", userResult.error);
  }
  if (viewerResult.error) {
    console.error("[record] viewer", viewerResult.error);
  }
  const usersById = new Map(
    ((userResult.data ?? []) as UserRow[]).map((row) => [row.id, row])
  );

  const timezone = zoneOrDenver((viewerRow as UserRow | null)?.timezone);
  const familyCode = (caseRow as { family_code?: string | null } | null)?.family_code?.trim() || "";
  const caseLabel = familyCode || caseId;

  const allMessages = (messageRows ?? []) as MessageRow[];
  const numbered: RecordEntry[] = allMessages.map((message, index) => ({
    message,
    number: messageNumber(index),
  }));
  const record = numbered.filter((entry) => passedBetweenParents(entry.message));

  const conversationIds = [
    ...new Set(
      record
        .map((entry) => entry.message.conversation_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const conversationsById = new Map<string, ConversationRow>();
  for (let i = 0; i < conversationIds.length; i += 200) {
    const slice = conversationIds.slice(i, i + 200);
    const { data, error } = await admin
      .from("conversations")
      .select("id, topic, category, subject")
      .in("id", slice);
    if (error) {
      console.error("[record] conversations", error);
      break;
    }
    for (const row of (data ?? []) as ConversationRow[]) {
      if (row.id) conversationsById.set(row.id, row);
    }
  }

  const groups = new Map<string, { heading: string; earliest: number; entries: RecordEntry[] }>();
  const ungrouped: RecordEntry[] = [];
  for (const entry of record) {
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

  const attachments = await loadAttachments(
    admin,
    record.map((entry) => entry.message.id)
  );

  const generatedAt = formatWhen(new Date().toISOString(), timezone);
  const range =
    record.length === 0
      ? "No messages"
      : (() => {
          const ordered = [...record].sort(
            (a, b) =>
              messageTime(a.message.created_at) - messageTime(b.message.created_at) ||
              a.message.id.localeCompare(b.message.id)
          );
          const start = formatDay(ordered[0].message.created_at, timezone);
          const end = formatDay(ordered[ordered.length - 1].message.created_at, timezone);
          return start === end ? start : `${start} - ${end}`;
        })();

  return (
    <div className="record">
      <style>{recordCss(caseLabel)}</style>
      <article className="sheet">
        <div className="screen-bar no-print">
          <p>Communication Record</p>
          <PrintRecordButton />
        </div>
        <header className="cover">
          <p className="brand">MyVow Parenting</p>
          <h1>Communication Record</h1>
          <dl className="facts">
            <div>
              <dt>Case</dt>
              <dd>{caseLabel}</dd>
            </div>
            <div>
              <dt>Parties</dt>
              <dd>
                {members.length === 0 ? (
                  "No parties stored"
                ) : (
                  <ul>
                    {members.map((member) => {
                      const account = member.user_id ? usersById.get(member.user_id) : undefined;
                      const label = partyLabel(member, account);
                      if (!label) return null;
                      return <li key={member.id}>{label}</li>;
                    })}
                  </ul>
                )}
              </dd>
            </div>
            <div>
              <dt>Date range</dt>
              <dd>{range}</dd>
            </div>
            <div>
              <dt>Generated</dt>
              <dd>
                {generatedAt}
                <p className="order">Grouped by conversation, earliest first.</p>
                <p className="order">
                  Message numbers reflect chronological position in this case as of the
                  generation time above.
                </p>
                <p className="order">
                  {completenessStatement(record.length, allMessages.length - record.length)}
                </p>
              </dd>
            </div>
          </dl>
        </header>
        {record.length === 0 ? (
          <p className="empty">No messages have passed between the parties.</p>
        ) : (
          <div className="threads">
            {threads.map((thread) => (
              <section key={thread.id} className="thread">
                <h2>{thread.heading}</h2>
                {renderMessages(thread.entries, usersById, members, attachments, timezone)}
              </section>
            ))}
            {ungrouped.length > 0 ? (
              <section className="thread">
                <h2>Ungrouped messages</h2>
                {renderMessages(ungrouped, usersById, members, attachments, timezone)}
              </section>
            ) : null}
          </div>
        )}
      </article>
    </div>
  );
}

function renderMessages(
  entries: RecordEntry[],
  usersById: Map<string, UserRow>,
  members: MemberRow[],
  attachments: Map<string, Attachment[]>,
  timezone: string
) {
  return (
    <ol className="messages">
      {entries.map((entry) => {
        const sender = senderIdentity(entry.message, usersById, members);
        const files = attachments.get(entry.message.id) ?? [];
        const direction =
          entry.message.direction === "incoming"
            ? "Incoming"
            : entry.message.direction === "outgoing"
              ? "Outgoing"
              : entry.message.direction;
        const body = renderRecordBody(entry.message.original_content);
        const delivery = deliveryEvidence(entry.message, timezone);
        const directionClass =
          entry.message.direction === "incoming" || entry.message.direction === "outgoing"
            ? entry.message.direction
            : "other";
        const long =
          body.text.length > 900 || (body.text.match(/\n/g)?.length ?? 0) > 18;
        return (
          <li key={entry.message.id} className={`message ${directionClass} ${long ? "long" : "short"}`}>
            <div className="msg-head">
              <div className="msg-idline">
                <p className="who">{senderLine(direction, sender)}</p>
                <p className="mid">Message {entry.number}</p>
              </div>
              <p className="when">Message time: {formatWhen(entry.message.created_at, timezone)}</p>
              {delivery.map((line) => (
                <p key={line} className="delivery">
                  {line}
                </p>
              ))}
            </div>
            <p className="body">{body.text}</p>
            {body.omitted ? (
              <p className="omit">[Signature and confidentiality notice omitted]</p>
            ) : null}
            {files.length > 0 ? (
              <p className="files">
                Attachments: {files.map(documentLabel).join("; ")}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Denied() {
  return (
    <main className="denied">
      <style>{plainPageCss}</style>
      <p>This record is only available to a signed-in member of the case.</p>
    </main>
  );
}

function Unavailable() {
  return (
    <main className="denied">
      <style>{plainPageCss}</style>
      <p>The communication record could not be loaded.</p>
    </main>
  );
}

const plainPageCss = `
  .denied { min-height: 100vh; margin: 0; padding: 48px 24px; background: #fff; color: #000; font-family: Georgia, "Times New Roman", serif; }
  .denied p { max-width: 36rem; margin: 0 auto; }
`;

async function loadAttachments(
  admin: ReturnType<typeof getServiceRoleClient>,
  messageIds: string[]
): Promise<Map<string, Attachment[]>> {
  const byMessage = new Map<string, Attachment[]>();
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
  const docs = new Map<string, Attachment>();
  for (let i = 0; i < documentIds.length; i += 200) {
    const slice = documentIds.slice(i, i + 200);
    const { data, error } = await admin
      .from("documents")
      .select("id, file_name, document_number")
      .in("id", slice);
    if (error) {
      console.error("[record] documents", error);
      break;
    }
    for (const row of data ?? []) {
      const id = (row as { id?: string }).id;
      const fileName = (row as { file_name?: string | null }).file_name?.trim();
      const documentNumber = (row as { document_number?: number | null }).document_number;
      if (!id || !fileName) continue;
      docs.set(id, {
        fileName,
        documentNumber: typeof documentNumber === "number" ? documentNumber : null,
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
    list.sort((a, b) => (a.documentNumber ?? 0) - (b.documentNumber ?? 0));
  }
  return byMessage;
}

function recordCss(caseLabel: string): string {
  const label = cssString(caseLabel);
  return `
    .record, .record * { box-sizing: border-box; }
    .record {
      min-height: 100vh;
      background: #fff;
      color: #161616;
      font-family: "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif;
      font-size: 11pt;
      line-height: 1.45;
    }
    .sheet { max-width: 8.5in; margin: 0 auto; padding: 0.75in; }
    .screen-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 0 0 18pt;
      font-family: "Segoe UI", system-ui, sans-serif;
      font-size: 10pt;
    }
    .screen-bar button {
      border: 1px solid #222;
      background: #fff;
      color: #161616;
      padding: 5px 14px;
      font: inherit;
      cursor: pointer;
    }
    .brand {
      margin: 0;
      font-size: 8.5pt;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #4a4a4a;
    }
    .cover { padding-bottom: 10pt; border-bottom: 1pt solid #222; }
    .cover h1 {
      margin: 2pt 0 12pt;
      font-size: 20pt;
      font-weight: 700;
      line-height: 1.15;
      letter-spacing: 0;
    }
    .facts { margin: 0; }
    .facts > div {
      display: grid;
      grid-template-columns: 5.6rem 1fr;
      column-gap: 0.7rem;
      align-items: baseline;
      padding: 3.5pt 0;
      border-bottom: 0.4pt solid #d5d5d5;
    }
    .facts dt {
      margin: 0;
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #3a3a3a;
    }
    .facts dd { margin: 0; font-size: 10.5pt; line-height: 1.4; }
    .facts ul { margin: 0; padding: 0; list-style: none; }
    .facts li { margin: 0; }
    .order { margin: 5pt 0 0; font-size: 9pt; line-height: 1.4; color: #222; }
    .empty { margin: 16pt 0 0; font-size: 11pt; }
    .thread { margin: 16pt 0 0; }
    .thread h2 {
      margin: 0 0 8pt;
      padding: 0 0 3pt;
      border-bottom: 0.75pt solid #222;
      font-size: 12.5pt;
      font-weight: 700;
      line-height: 1.3;
      break-after: avoid;
      page-break-after: avoid;
    }
    .messages { list-style: none; margin: 0; padding: 0; }
    .message {
      margin: 0;
      padding: 8pt 0 9pt 9pt;
      border-bottom: 0.4pt solid #d0d0d0;
      border-left: 2.25pt solid #c4c4c4;
    }
    .message.incoming { border-left-color: #3f3f3f; }
    .message.outgoing { border-left-color: #b7b7b7; }
    .message.short {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .msg-head {
      break-inside: avoid;
      page-break-inside: avoid;
      break-after: avoid;
      page-break-after: avoid;
    }
    .msg-idline {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12pt;
    }
    .who {
      margin: 0;
      font-size: 11pt;
      font-weight: 700;
      line-height: 1.35;
      color: #111;
    }
    .when, .delivery, .files, .mid {
      margin: 1pt 0 0;
      font-size: 8.5pt;
      font-weight: 400;
      line-height: 1.35;
      color: #333;
    }
    .mid { margin: 0; white-space: nowrap; }
    .body, .omit {
      margin: 6pt 0 0;
      font-size: 11pt;
      font-weight: 400;
      line-height: 1.45;
      color: #161616;
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }
    .omit, .files { break-before: avoid; page-break-before: avoid; }
    .files { margin-top: 4pt; }
    @page {
      size: letter;
      margin: 0.75in;
      @top-left {
        content: "Communication Record";
        font-family: "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
        font-size: 8.5pt;
        color: #444;
      }
      @top-center {
        content: "Case ${label}";
        font-family: "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
        font-size: 8.5pt;
        color: #444;
      }
      @top-right {
        content: "Page " counter(page);
        font-family: "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
        font-size: 8.5pt;
        color: #444;
      }
    }
    @media print {
      .no-print { display: none !important; }
      html, body { background: #fff !important; color: #161616 !important; }
      .record { background: #fff; color: #161616; }
      .sheet { max-width: none; margin: 0; padding: 0; }
      .message {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  `;
}
