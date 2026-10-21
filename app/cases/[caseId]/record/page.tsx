import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { renderRecordBody } from "@/lib/record/message-text";
import { completenessStatement } from "@/lib/record/record-filters";
import { loadCommunicationRecord } from "@/lib/record/load-communication-record";
import {
  deliveryEvidence,
  documentLabel,
  formatWhen,
  partyLabel,
  senderIdentity,
  senderLine,
  type Attachment,
  type MemberRow,
  type RecordEntry,
  type UserRow,
} from "@/lib/record/record-present";
import { PrintRecordButton } from "./print-record-button";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cssString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/</g, "")
    .replace(/[\r\n]+/g, " ");
}

export default async function CaseRecordPage({
  params,
  searchParams,
}: {
  params: { caseId: string };
  searchParams: Record<string, string | string[] | undefined>;
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
    return await renderRecord(admin, user.id, caseId, searchParams);
  } catch (error) {
    console.error("[record]", error);
    return <Unavailable />;
  }
}

async function renderRecord(
  admin: ReturnType<typeof getServiceRoleClient>,
  userId: string,
  caseId: string,
  searchParams: Record<string, string | string[] | undefined>
) {
  const loaded = await loadCommunicationRecord(admin, userId, caseId, searchParams);
  if (!loaded.ok) {
    if (loaded.reason === "denied") return <Denied />;
    return <Unavailable />;
  }
  const {
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
    eligibleCount,
    notPassed,
    threads,
    ungrouped,
    attachments,
  } = loaded.view;
  const filtered = filterLines.length > 0;

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
                  {completenessStatement({
                    included: shown.length,
                    eligible: eligibleCount,
                    notPassed,
                    filtered,
                  })}
                </p>
              </dd>
            </div>
          </dl>
          {filters.category && !categoryAvailable ? (
            <p className="notice">
              The category filter was not applied because conversation categories are not set up
              yet.
            </p>
          ) : null}
          {filterLines.length > 0 ? (
            <div className="filters">
              <h2>Filters Applied</h2>
              <ul>
                {filterLines.map((line) => (
                  <li key={line.label}>
                    <span>{line.label}:</span> {line.value}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </header>
        {shown.length === 0 ? (
          <p className="empty">
            {eligibleCount === 0
              ? "No messages have passed between the parties."
              : "No messages match the selected filters. Messages that do not match remain in the case record."}
          </p>
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
    .notice { margin: 8pt 0 0; font-size: 9pt; line-height: 1.4; }
    .filters { margin: 10pt 0 0; }
    .filters h2 {
      margin: 0 0 3pt;
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #3a3a3a;
    }
    .filters ul { margin: 0; padding: 0; list-style: none; }
    .filters li { margin: 0; padding: 1pt 0; font-size: 10.5pt; line-height: 1.4; }
    .filters span { font-weight: 700; }
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
