import assert from "node:assert/strict";
import { PDFDocument, PDFName } from "pdf-lib";
import { assembleCommunicationPdf } from "@/lib/reports/communication-record-assemble";
import {
  communicationCsv,
  compareCommunicationRows,
  csvField,
  deliveredStamp,
  planEvidence,
  receivedStamp,
  recipientLabel,
  sentStamp,
  subjectText,
  type CommunicationRecordModel,
  type CommunicationRow,
} from "@/lib/reports/communication-record";
import { buildChronologicalPdf, buildTranscriptPdf } from "@/lib/reports/communication-record-pdf";
import type { SupportingFile } from "@/lib/reports/embed-attachments";

function row(overrides: Partial<CommunicationRow> & Pick<CommunicationRow, "id" | "number" | "createdAt">): CommunicationRow {
  return {
    conversationId: "conv-1",
    subject: "School pickup",
    threadKey: "conv-1",
    threadHeading: "School pickup",
    deliveredAt: null,
    direction: "outgoing",
    sender: "Alex Parent\nalex@example.com",
    transcriptWho: "Outgoing, sent by Alex Parent (alex@example.com)",
    recipient: "Blake Parent (blake@example.com)",
    body: "Original wording.",
    transcriptText: "Original wording.",
    transcriptOmitted: false,
    categories: ["education"],
    attachments: [],
    deliveryLines: [],
    recordedLabel: "Mar 1, 2026, 6:04 PM MST",
    ...overrides,
  };
}

function model(rows: CommunicationRow[]): CommunicationRecordModel {
  return {
    caseLabel: "FAM-100",
    parties: ["Alex Parent (alex@example.com)", "Blake Parent (blake@example.com)"],
    timezone: "America/Denver",
    generatedAtIso: "2026-03-02T18:00:00.000Z",
    generatedLabel: "Mar 2, 2026, 11:00 AM MST",
    reportingPeriod: "All time",
    messageSpan: "Mar 1, 2026 - Mar 3, 2026",
    filterLines: [{ label: "Search", value: "pickup" }],
    completeness: "This is a filtered communication record.",
    categoryNotice: null,
    rows,
    threads: [
      { heading: "School pickup", rows: rows.filter((item) => item.threadKey === "conv-1") },
      { heading: "Medical", rows: rows.filter((item) => item.threadKey === "conv-2") },
    ].filter((thread) => thread.rows.length > 0),
  };
}

const earlier = row({
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  number: "MSG-002",
  createdAt: "2026-03-01T18:00:00.000Z",
  conversationId: "conv-2",
  threadKey: "conv-2",
  threadHeading: "Medical",
  subject: subjectText(null),
  direction: "incoming",
  deliveredAt: "2026-03-01T18:05:00.000Z",
  body: "Please bring the forms.\nLine two, with a comma, and a \"quote\".",
  transcriptText: "Please bring the forms.",
  sender: "Blake Parent\nblake@example.com",
  transcriptWho: "Incoming, sent by Blake Parent (blake@example.com)",
  recipient: "Alex Parent (alex@example.com)",
});

const later = row({
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  number: "MSG-010",
  createdAt: "2026-03-01T18:00:00.000Z",
  body: `Full original text ${"word ".repeat(80)}END-OF-ORIGINAL-BODY-XYZ`,
});

const ordered = [later, earlier].sort(compareCommunicationRows);
assert.deepEqual(
  ordered.map((item) => item.number),
  ["MSG-010", "MSG-002"],
  "identical timestamps use the message id as the secondary key"
);
const older = row({
  id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  number: "MSG-001",
  createdAt: "2026-02-01T18:00:00.000Z",
  conversationId: "conv-9",
  threadKey: "conv-9",
  subject: "Earlier subject",
});
assert.deepEqual(
  [later, older].sort(compareCommunicationRows).map((item) => item.number),
  ["MSG-001", "MSG-010"]
);
assert.equal(subjectText("  "), "No subject recorded");
assert.equal(recipientLabel(null, [{ userId: "viewer", label: "Viewer" }]), "Not recorded");
assert.equal(
  recipientLabel("viewer", [
    { userId: "viewer", label: "Viewer" },
    { userId: "other", label: "Other Parent" },
  ]),
  "Other Parent"
);
assert.equal(
  recipientLabel("viewer", [
    { userId: "viewer", label: "Viewer" },
    { userId: "one", label: "One" },
    { userId: "two", label: "Two" },
  ]),
  "Not recorded"
);

assert.equal(sentStamp(earlier, "America/Denver"), "");
assert.match(receivedStamp(earlier, "America/Denver"), /^2026-03-01 11:05:00 UTC-0?7$/);
assert.match(deliveredStamp(earlier, "America/Denver"), /^2026-03-01 11:05:00 UTC-0?7$/);
assert.match(sentStamp(later, "America/Denver"), /^2026-03-01 11:00:00 UTC-0?7$/);
assert.equal(receivedStamp(later, "America/Denver"), "");
assert.equal(deliveredStamp({ ...later, deliveredAt: null }, "America/Denver"), "");

const csv = communicationCsv(model(ordered));
assert.ok(csv.startsWith("\uFEFF"));
assert.match(csv, /Message ID,Conversation ID,Subject,Recorded timestamp/);
assert.match(csv, /"Please bring the forms\.\r?\nLine two, with a comma, and a ""quote""\."/);
assert.match(csv, /END-OF-ORIGINAL-BODY-XYZ/);
assert.equal(csvField("plain"), "plain");
assert.doesNotMatch(csv, /ai_rewritten|Suggested response|summary/i);

const record = model(ordered);
const table = buildChronologicalPdf(record, null, "payload");
const tableText = table.buffer.toString("latin1");
assert.match(tableText, /END-OF-ORIGINAL-BODY-XYZ/);
assert.match(tableText, /No subject recorded/);
assert.match(tableText, /MYVOW PARENTING/);
assert.match(tableText, /No attachment/);
assert.match(tableText, /does not cover attachment file bytes/);
assert.equal(table.pageCount >= 1, true);

const transcript = buildTranscriptPdf(record, null, "payload");
const transcriptText = transcript.buffer.toString("latin1");
assert.match(transcriptText, /Medical/);
assert.match(transcriptText, /School pickup/);
assert.match(transcriptText, /Grouped by conversation/);

async function main() {
  const src = await PDFDocument.create();
  src.addPage([200, 200]);
  const bytes = Buffer.from(await src.save());
  const shared: SupportingFile = {
    key: "doc-1",
    records: ["MSG-002", "MSG-010"],
    fileName: "note.pdf",
    mimeType: "application/pdf",
    bytes,
    unavailableReason: null,
  };
  let seenLabel = "";
  const assembled = await assembleCommunicationPdf(
    (evidence) => {
      const refs = evidence?.get("MSG-002") ?? [];
      seenLabel = refs.map((ref) => ref.label).join("; ");
      return buildChronologicalPdf(record, evidence, "payload");
    },
    [shared, { ...shared, records: ["MSG-010"] }],
    true
  );
  const pages = seenLabel.match(/\d+/g)?.map(Number) ?? [];
  assert.equal(pages.length, 2);
  assert.equal(pages[1] - pages[0] + 1, 2);
  const pdf = await PDFDocument.load(assembled.pdf);
  assert.equal(pdf.getPageCount(), pages[1]);
  let linked = false;
  for (let index = 0; index < pdf.getPageCount(); index += 1) {
    if (pdf.getPage(index).node.lookup(PDFName.of("Annots"))) linked = true;
  }
  assert.equal(linked, true);
  const planned = planEvidence(1, [{ records: ["MSG-002"], pages: 2 }]);
  assert.equal(planned.get("MSG-002")?.[0].label, "Document number not assigned, pp. 2–3");
  console.log("communication record tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
