import assert from "node:assert/strict";
import {
  decideInboundAttachment,
  documentsForMessage,
  inboundDeliveryAction,
  sageAttachmentSentences,
  sageReadsAttachment,
} from "@/lib/messages/inbound-attachment";

function b64(bytes: Buffer): string {
  return bytes.toString("base64");
}

const xlsx = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("xl/workbook.xml"),
]);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n");
const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const program = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);

const sheet = decideInboundAttachment({
  name: "Pediatrician listing.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  contentBase64: b64(xlsx),
});
assert.equal(sheet.ok, true);
if (sheet.ok) {
  assert.equal(sheet.filename, "Pediatrician listing.xlsx");
  assert.equal(
    sheet.mimeType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.equal(sheet.bytes.equals(xlsx), true);
  assert.equal(sageReadsAttachment(sheet.filename, sheet.mimeType), false);
}

const oldSheet = decideInboundAttachment({
  name: "legacy.xls",
  contentType: "application/vnd.ms-excel",
  contentBase64: b64(xls),
});
assert.equal(oldSheet.ok, true);

const pdfFile = decideInboundAttachment({
  name: "note.pdf",
  contentType: "application/pdf",
  contentBase64: b64(pdf),
});
assert.equal(pdfFile.ok, true);
if (pdfFile.ok) assert.equal(sageReadsAttachment(pdfFile.filename, pdfFile.mimeType), true);

const mixed = [
  decideInboundAttachment({
    name: "Pediatrician listing.xlsx",
    contentType: "application/octet-stream",
    contentBase64: b64(xlsx),
  }),
  decideInboundAttachment({
    name: "note.pdf",
    contentType: "application/pdf",
    contentBase64: b64(pdf),
  }),
];
assert.deepEqual(
  mixed.map((file) => (file.ok ? file.filename : file.reason)),
  ["Pediatrician listing.xlsx", "note.pdf"]
);

const unsafe = decideInboundAttachment({
  name: "Pediatrician listing.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  contentBase64: b64(program),
});
assert.equal(unsafe.ok, false);
if (!unsafe.ok) {
  assert.match(unsafe.reason, /can't be stored|don't match/i);
  assert.doesNotMatch(unsafe.reason, /did not come through/i);
}

const blocked = decideInboundAttachment({
  name: "setup.exe",
  contentType: "application/octet-stream",
  contentBase64: b64(program),
});
assert.equal(blocked.ok, false);

const missing = decideInboundAttachment({
  name: "Pediatrician listing.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  contentBase64: null,
});
assert.equal(missing.ok, false);

const saved = sageAttachmentSentences({
  saved: [{ filename: "Pediatrician listing.xlsx", read: false }],
  failed: [],
});
assert.match(saved, /Pediatrician listing\.xlsx is attached/);
assert.match(saved, /haven't read its contents/);
assert.doesNotMatch(saved, /analyz|did not come through|didn't come through/i);

const failedSave = sageAttachmentSentences({
  saved: [],
  failed: [{ filename: "Pediatrician listing.xlsx", reason: "Storage upload failed." }],
});
assert.match(failedSave, /did not save/);
assert.match(failedSave, /Storage upload failed/);
assert.doesNotMatch(failedSave, /did not come through/i);

const several = sageAttachmentSentences({
  saved: [
    { filename: "Pediatrician listing.xlsx", read: false },
    { filename: "note.pdf", read: true },
  ],
  failed: [{ filename: "setup.exe", reason: "That file type isn't supported." }],
});
assert.match(several, /Pediatrician listing\.xlsx is attached\. I haven't read its contents\./);
assert.match(several, /note\.pdf is attached\./);
assert.match(several, /setup\.exe did not save/);

assert.equal(inboundDeliveryAction({ duplicate: true }), "stop");
assert.equal(inboundDeliveryAction({ error: "insert failed" }), "stop");
assert.equal(inboundDeliveryAction({ id: "intake-1" }), "process");

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const links = [
  { messageId: first, documentId: "doc-xlsx" },
  { messageId: second, documentId: "doc-pdf" },
];
const documents = [
  { id: "doc-xlsx", fileName: "Pediatrician listing.xlsx" },
  { id: "doc-pdf", fileName: "note.pdf" },
];
assert.deepEqual(
  documentsForMessage(first, links, documents).map((file) => file.fileName),
  ["Pediatrician listing.xlsx"]
);
assert.deepEqual(
  documentsForMessage(second, links, documents).map((file) => file.fileName),
  ["note.pdf"]
);

console.log("inbound attachment tests passed");
