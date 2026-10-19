import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
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
  original_content: string;
  current_status: string | null;
  delivery_status: string | null;
  delivered_at: string | null;
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

function formatWhen(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "long",
    timeStyle: "short",
    timeZoneName: "short",
  }).format(date);
}

function formatDay(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "long",
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

function messageNumber(index: number): string {
  return `MSG-${String(index + 1).padStart(3, "0")}`;
}

function documentLabel(attachment: Attachment): string {
  if (attachment.documentNumber == null) return attachment.fileName;
  return `${attachment.fileName} (DOC-${String(attachment.documentNumber).padStart(3, "0")})`;
}

function partyName(member: MemberRow, user: UserRow | undefined): string {
  const stored =
    member.display_name?.trim() ||
    member.invited_name?.trim() ||
    user?.full_name?.trim() ||
    "";
  return stored || "Name not stored";
}

function partyEmail(member: MemberRow, user: UserRow | undefined): string {
  const stored =
    member.external_email?.trim() ||
    member.invited_email?.trim() ||
    user?.email?.trim() ||
    "";
  return stored || "Email not stored";
}

function senderIdentity(
  message: MessageRow,
  usersById: Map<string, UserRow>,
  members: MemberRow[]
): { name: string; email: string } {
  if (message.sender_id) {
    const user = usersById.get(message.sender_id);
    const member = members.find((row) => row.user_id === message.sender_id);
    const name =
      member?.display_name?.trim() ||
      member?.invited_name?.trim() ||
      user?.full_name?.trim() ||
      "Name not stored";
    const email =
      user?.email?.trim() ||
      member?.external_email?.trim() ||
      member?.invited_email?.trim() ||
      "Email not stored";
    return { name, email };
  }
  const email = message.sender_external_email?.trim() || "";
  const member = members.find((row) => {
    const stored = (row.external_email || row.invited_email || "").trim().toLowerCase();
    return email !== "" && stored === email.toLowerCase();
  });
  return {
    name: member?.display_name?.trim() || member?.invited_name?.trim() || "Name not stored",
    email: email || "Email not stored",
  };
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
        "id, created_at, direction, sender_id, sender_external_email, original_content, current_status, delivery_status, delivered_at"
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

  const timezone =
    (viewerRow as UserRow | null)?.timezone?.trim() ||
    "America/Denver";
  const familyCode = (caseRow as { family_code?: string | null } | null)?.family_code?.trim() || "";
  const caseLabel = familyCode || caseId;

  const allMessages = (messageRows ?? []) as MessageRow[];
  const numbered = allMessages.map((message, index) => ({
    message,
    number: messageNumber(index),
  }));
  const record = numbered.filter((entry) => passedBetweenParents(entry.message));

  const attachments = await loadAttachments(
    admin,
    record.map((entry) => entry.message.id)
  );

  const generatedAt = formatWhen(new Date().toISOString(), timezone);
  const range =
    record.length === 0
      ? "No messages"
      : (() => {
          const start = formatDay(record[0].message.created_at, timezone);
          const end = formatDay(record[record.length - 1].message.created_at, timezone);
          return start === end ? start : `${start} - ${end}`;
        })();

  return (
    <div className="record">
      <style>{recordCss(caseLabel)}</style>
      <article className="sheet">
        <div className="screen-bar no-print">
          <p>Communication record</p>
          <PrintRecordButton />
        </div>
        <header className="cover">
          <h1>Communication record</h1>
          <dl>
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
                      return (
                        <li key={member.id}>
                          {partyName(member, account)} ({partyEmail(member, account)})
                        </li>
                      );
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
              <dd>{generatedAt}</dd>
            </div>
          </dl>
        </header>
        {record.length === 0 ? (
          <p className="empty">No messages have passed between the parties.</p>
        ) : (
          <ol className="messages">
            {record.map((entry) => {
              const sender = senderIdentity(entry.message, usersById, members);
              const files = attachments.get(entry.message.id) ?? [];
              const direction =
                entry.message.direction === "incoming"
                  ? "Incoming"
                  : entry.message.direction === "outgoing"
                    ? "Outgoing"
                    : entry.message.direction;
              return (
                <li key={entry.message.id} className="message">
                  <p className="when">{formatWhen(entry.message.created_at, timezone)}</p>
                  <p className="who">
                    {direction}, sent by {sender.name} ({sender.email})
                  </p>
                  <p className="body">{entry.message.original_content}</p>
                  {files.length > 0 ? (
                    <p className="files">
                      Attachments: {files.map(documentLabel).join("; ")}
                    </p>
                  ) : null}
                  <p className="mid">Message {entry.number}</p>
                </li>
              );
            })}
          </ol>
        )}
      </article>
    </div>
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
      color: #000;
      font-family: Georgia, "Times New Roman", serif;
    }
    .sheet { max-width: 7.5in; margin: 0 auto; padding: 32px 24px 64px; }
    .screen-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      font-family: system-ui, sans-serif;
      font-size: 14px;
    }
    .screen-bar button {
      border: 1px solid #000;
      background: #fff;
      color: #000;
      padding: 6px 14px;
      font: inherit;
      cursor: pointer;
    }
    .cover h1 { font-size: 22px; font-weight: 700; margin: 0 0 16px; }
    .cover dl { margin: 0; }
    .cover dl > div { margin: 0 0 10px; }
    .cover dt { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
    .cover dd { margin: 2px 0 0; font-size: 14px; }
    .cover ul { margin: 0; padding-left: 1.1em; }
    .empty { margin-top: 24px; }
    .messages { list-style: none; margin: 28px 0 0; padding: 0; }
    .message {
      border-top: 1px solid #000;
      padding: 14px 0 16px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .when, .who, .files, .mid { margin: 0 0 6px; font-size: 12px; }
    .who, .mid { font-weight: 700; }
    .body { margin: 8px 0; font-size: 14px; white-space: pre-wrap; }
    @page {
      size: letter;
      margin: 0.85in 0.7in 0.7in 0.7in;
      @top-left {
        content: "Case ${label}";
        font-family: Georgia, "Times New Roman", serif;
        font-size: 10pt;
        color: #000;
      }
      @top-right {
        content: "Page " counter(page);
        font-family: Georgia, "Times New Roman", serif;
        font-size: 10pt;
        color: #000;
      }
    }
    @media print {
      .no-print { display: none !important; }
      html, body { background: #fff !important; color: #000 !important; }
      .record { background: #fff; color: #000; }
      .sheet { max-width: none; margin: 0; padding: 0; }
    }
  `;
}
