import { attachmentInstruction } from "@/lib/sage/attachment-role";

const FILE_WORD =
  /\b(files?|spreadsheets?|workbooks?|attachments?|documents?|reports?|evaluations?|pdfs?|sheets?|csvs?|listings?)\b|\.(?:xlsx|xls|csv|docx|doc|pdf|txt)\b/i;
const EXAMINE =
  /\b(read|review|summarize|summarise|summary|explain|compare|analyze|analyse|look at|look over|go through|what do you think|what you think|think of|thoughts on|make of|which of)\b/i;
const TO_SAGE = /\b(you|your)\b/i;
const IMPERATIVE = /^(please\s+)?(read|review|summarize|summarise|explain|compare|look)\b/i;

function addressesCoparent(text: string): boolean {
  return /\bco[-\s]?parents?\b/i.test(text) || /\b(?:the\s+)?other\s+parent\b/i.test(text);
}

/**
 * The parent is asking Sage to examine a file.
 * Sending or filing stays on those existing paths.
 * A file sitting in the conversation is not itself a request.
 */
export function requestsDocumentAnalysis(message: string, fileInReach: boolean): boolean {
  const text = message.trim();
  if (!text) return false;
  const instruction = attachmentInstruction(text);
  if (instruction === "message" || instruction === "save" || instruction === "save_and_message") return false;
  if (instruction === "summarize") return true;
  if (addressesCoparent(text) && /\b(send|share|forward|tell|let|ask|have)\b/i.test(text)) return false;
  const examines = EXAMINE.test(text);
  const mentionsFile = FILE_WORD.test(text);
  const toSage = TO_SAGE.test(text) || /\b(let me know|tell me)\b/i.test(text);
  if (examines && mentionsFile && (toSage || IMPERATIVE.test(text))) return true;
  if (!fileInReach || !examines) return false;
  if (/\bwhich of these\b/i.test(text)) return true;
  return toSage && (mentionsFile || /\b(these|this|that|the list|the options)\b/i.test(text));
}
