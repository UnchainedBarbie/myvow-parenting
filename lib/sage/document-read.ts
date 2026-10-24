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

export type AnalysisTurn = { role: "parent" | "sage"; text: string };

/**
 * The parent is asking Sage to examine a file.
 * Sending or filing stays on those existing paths.
 * A file sitting in the conversation is not itself a request.
 * A follow-up can continue a read that already happened in this session.
 */
export function requestsDocumentAnalysis(
  message: string,
  fileInReach: boolean,
  recentTurns: AnalysisTurn[] = []
): boolean {
  const text = message.trim();
  if (!text) return false;
  const instruction = attachmentInstruction(text);
  if (instruction === "message" || instruction === "save" || instruction === "save_and_message") return false;
  if (addressesCoparent(text) && /\b(send|share|forward|tell|let|ask|have)\b/i.test(text)) return false;
  if (instruction === "summarize") return true;
  if (continuesDocumentAnalysis(text, fileInReach, recentTurns)) return true;
  const examines = EXAMINE.test(text);
  const mentionsFile = FILE_WORD.test(text);
  const toSage = TO_SAGE.test(text) || /\b(let me know|tell me)\b/i.test(text);
  if (examines && mentionsFile && (toSage || IMPERATIVE.test(text))) return true;
  if (!fileInReach) return false;
  if (
    /\b(compare|recommend|which option|which of these|what information is missing|what's missing|what is missing)\b/i.test(
      text
    )
  ) {
    return true;
  }
  if (!examines) return false;
  return toSage && (mentionsFile || /\b(these|this|that|the list|the options)\b/i.test(text));
}

/** A question about a document Sage already read, without naming the file again. */
export function continuesDocumentAnalysis(
  message: string,
  fileInReach: boolean,
  recentTurns: AnalysisTurn[]
): boolean {
  if (!fileInReach) return false;
  const instruction = attachmentInstruction(message);
  if (instruction === "message" || instruction === "save" || instruction === "save_and_message") return false;
  if (addressesCoparent(message) && /\b(send|share|forward)\b/i.test(message)) return false;
  if (/\b(add|schedule|log)\b/i.test(message) && /\b(calendar|expense|receipt)\b/i.test(message)) return false;
  const prior = [...recentTurns].reverse().find((turn) => turn.role === "sage" && /\bI read\b/i.test(turn.text));
  if (!prior) return false;
  return /\b(these|this|that|second|first|third|practice|doctor|pediatrician|option|missing|recommend|compare|more about|tell me more|which|information|sheet|row)\b/i.test(
    message
  );
}
