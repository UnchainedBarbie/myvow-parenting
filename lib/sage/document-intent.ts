import { documentCanBeRead, documentFileProblem } from "@/lib/documents-files";
import { isInactiveProposal, reviseProposal } from "@/lib/sage/proposal-lifecycle";

export type DocumentVisibility = "private" | "parents_only" | "family";

export type KnownDocumentChild = { id: string; name: string };

export type DocumentProposalState = {
  key: string;
  title: string;
  description: string;
  category: string;
  visibility: DocumentVisibility;
  childName: string | null;
  childId: string | null;
  fileName: string | null;
  documentId: string | null;
  requiresApproval: true;
  /** True when this proposal updates a document that is already filed. */
  updatesExisting: boolean;
};

export type DocumentThread = {
  pending: DocumentProposalState | null;
  filed: DocumentProposalState | null;
};

type KindRule = {
  re: RegExp;
  label: string;
  sentence: string;
  category: string;
};

const KIND_RULES: KindRule[] = [
  {
    re: /\boccupational therapy evaluation\b/i,
    label: "Occupational Therapy Evaluation",
    sentence: "Occupational therapy evaluation",
    category: "therapy",
  },
  {
    re: /\bphysical therapy evaluation\b/i,
    label: "Physical Therapy Evaluation",
    sentence: "Physical therapy evaluation",
    category: "therapy",
  },
  {
    re: /\bspeech(?: |-)?therapy evaluation\b/i,
    label: "Speech Therapy Evaluation",
    sentence: "Speech therapy evaluation",
    category: "therapy",
  },
  {
    re: /\btherapy evaluation\b/i,
    label: "Therapy Evaluation",
    sentence: "Therapy evaluation",
    category: "therapy",
  },
  {
    re: /\b(?:occupational therapy|\bot evaluation|\bot\b)/i,
    label: "Occupational Therapy Evaluation",
    sentence: "Occupational therapy evaluation",
    category: "therapy",
  },
  {
    re: /\bcounsel(?:ing|ling)\b/i,
    label: "Counseling Record",
    sentence: "Counseling record",
    category: "therapy",
  },
  {
    re: /\bmedical (?:records?|documents?|reports?)\b/i,
    label: "Medical Record",
    sentence: "Medical record",
    category: "medical",
  },
  {
    re: /\b(?:school report|report card)\b/i,
    label: "School Report",
    sentence: "School report",
    category: "school",
  },
  {
    re: /\bcourt order\b/i,
    label: "Court Order",
    sentence: "Court order",
    category: "court_order",
  },
  {
    re: /\bincident report\b/i,
    label: "Incident Report",
    sentence: "Incident report",
    category: "incident",
  },
];

const HEALTH_CATEGORIES = new Set(["medical", "therapy"]);

export function isScheduleRequest(text: string): boolean {
  if (/\b(save|file|store)\b/i.test(text) && /\b(document|documents|record|records|evaluation)\b/i.test(text)) {
    return false;
  }
  return (
    /\b(add|put|schedule|book)\b/i.test(text) &&
    /\b(calendar|appointment)\b/i.test(text)
  );
}

export function isDocumentFilingRequest(text: string): boolean {
  if (isScheduleRequest(text)) return false;
  if (/\b(save|file|store|upload)\b/i.test(text) && /\b(document|documents|record|records|evaluation|report)\b/i.test(text)) {
    return true;
  }
  return /\bthis is\b/i.test(text) && /\b(evaluation|report|record|document)\b/i.test(text);
}

const DOCUMENT_REFERENCE =
  /\b(this|that|the|her|his)\s+(evaluation|document|record|report|file)\b/i;

const DESCRIPTION_EDIT =
  /\b(include that|include this|add that|add this|in the description|the description|update the description|change the description|change the title)\b/i;

/** A follow-up about a document already in the conversation, not a new filing. */
export function isDocumentEdit(text: string): boolean {
  if (DESCRIPTION_EDIT.test(text)) return true;
  return (
    DOCUMENT_REFERENCE.test(text) &&
    /\b(completed|description|title|include|change|update|add)\b/i.test(text)
  );
}

/**
 * A file sent after the filing sentence still uses that sentence.
 * A file sent onto an open proposal keeps that proposal's text.
 */
export function attachmentFilingText(
  caption: string,
  priorText: string | null | undefined,
  hasPending: boolean
): string {
  const current = caption.trim();
  if (current) return current;
  if (hasPending) return "";
  const prior = (priorText ?? "").replace(/\n+Attached:[\s\S]*$/, "").trim();
  return isDocumentFilingRequest(prior) ? prior : "";
}

export function titleIsFileName(title: string, fileName: string | null | undefined): boolean {
  const current = title.trim().toLowerCase();
  const file = (fileName ?? "").trim();
  if (!current || !file) return false;
  const stem = file.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " ").trim().toLowerCase();
  return current === file.toLowerCase() || current === stem;
}

export function documentStateFromRaw(raw: unknown): DocumentProposalState | null {
  if (!raw || typeof raw !== "object") return null;
  const proposal = raw as Record<string, unknown>;
  if (proposal.type !== "log_document" && proposal.type !== "file_document") return null;
  if (isInactiveProposal(proposal)) return null;
  const fileName = typeof proposal.attached_file_name === "string" ? proposal.attached_file_name : null;
  const documentId = typeof proposal.attached_document_id === "string" ? proposal.attached_document_id : null;
  const description = typeof proposal.description === "string" ? proposal.description : "";
  const draft = typeof proposal.draft === "string" ? proposal.draft : "";
  const quoted = draft.match(/File “([^”]+)”/);
  const title =
    (typeof proposal.title === "string" && proposal.title.trim()) ||
    quoted?.[1]?.trim() ||
    description.trim() ||
    fileName ||
    "";
  if (!title && !description && !fileName && !documentId) return null;
  const visibility: DocumentVisibility =
    proposal.visibility === "private" || proposal.visibility === "family" || proposal.visibility === "parents_only"
      ? proposal.visibility
      : "parents_only";
  return {
    key: typeof proposal.key === "string" && proposal.key.trim() ? proposal.key : "pending-document",
    title: title || "Document",
    description,
    category: typeof proposal.category === "string" && proposal.category.trim() ? proposal.category : "other",
    visibility,
    childName: typeof proposal.document_child_name === "string" ? proposal.document_child_name : null,
    childId: typeof proposal.document_child_id === "string" ? proposal.document_child_id : null,
    fileName,
    documentId,
    requiresApproval: true,
    updatesExisting: proposal.updatesExisting === true,
  };
}

export function filedDocumentState(
  doc: {
    id: string;
    title: string;
    description: string;
    category: string;
    fileName: string;
    childIds: string[];
    visibility: string;
  },
  children: KnownDocumentChild[]
): DocumentProposalState {
  const child = children.find((item) => doc.childIds.includes(item.id)) ?? null;
  const visibility: DocumentVisibility =
    doc.visibility === "private" || doc.visibility === "family" || doc.visibility === "parents_only"
      ? doc.visibility
      : "parents_only";
  return {
    key: `update-${doc.id}`,
    title: doc.title || "Document",
    description: doc.description,
    category: doc.category || "other",
    visibility,
    childName: child?.name ?? null,
    childId: child?.id ?? doc.childIds[0] ?? null,
    fileName: doc.fileName || null,
    documentId: doc.id,
    requiresApproval: true,
    updatesExisting: true,
  };
}

/** Fill a review row when the stored proposal still has the filename and an empty description. */
export function completeDocumentReview(input: {
  title: string;
  description: string;
  category: string;
  visibility: string;
  childId: string | null;
  childName: string | null;
  fileName: string | null;
  draft: string;
  children: KnownDocumentChild[];
  today?: Date;
  timezone?: string;
}): {
  title: string;
  description: string;
  category: string;
  visibility: DocumentVisibility;
  childId: string | null;
  childName: string | null;
} {
  const interpreted = interpretDocumentTurn({
    text: [input.draft, input.title, input.description].filter((part) => part.trim()).join("\n"),
    fileName: input.fileName,
    children: input.children,
    pending: null,
    filed: null,
    today: input.today ?? new Date(),
    timezone: input.timezone ?? "America/Denver",
  });
  const filing =
    interpreted.action === "create" || interpreted.action === "revise" ? interpreted.proposal : null;
  const weakTitle = !input.title.trim() || titleIsFileName(input.title, input.fileName);
  const visibility: DocumentVisibility =
    input.visibility === "private" || input.visibility === "family" || input.visibility === "parents_only"
      ? input.visibility
      : filing?.visibility ?? "parents_only";
  return {
    title: !weakTitle ? input.title.trim() : filing?.title || input.title.trim() || input.fileName || "Document",
    description: input.description.trim() || filing?.description || "",
    category:
      input.category.trim() && input.category !== "other"
        ? input.category
        : filing?.category || input.category || "other",
    visibility,
    childId: input.childId || filing?.childId || null,
    childName: input.childName || filing?.childName || null,
  };
}

export function openDocumentStates(
  open: { type: string; text?: string; document?: DocumentProposalState | null }[] | undefined
): DocumentProposalState[] {
  const states: DocumentProposalState[] = [];
  for (const item of open ?? []) {
    if (item.type !== "log_document" && item.type !== "file_document") continue;
    if (item.document?.requiresApproval) {
      states.push(item.document);
      continue;
    }
    const text = (item.text ?? "").trim();
    if (!text) continue;
    const title = text.replace(/^File “([^”]+)”.*/, "$1").trim() || "Document";
    states.push({
      key: "pending-document",
      title,
      description: text,
      category: "other",
      visibility: "parents_only",
      childName: null,
      childId: null,
      fileName: null,
      documentId: null,
      requiresApproval: true,
      updatesExisting: false,
    });
  }
  return states;
}

export function selectDocumentTarget(input: {
  text: string;
  pending: DocumentProposalState[];
  filed: DocumentProposalState | null;
}):
  | { kind: "none" }
  | { kind: "ask"; question: string }
  | { kind: "pending"; proposal: DocumentProposalState }
  | { kind: "filed"; proposal: DocumentProposalState } {
  if (!isDocumentEdit(input.text)) return { kind: "none" };
  if (input.pending.length === 0 && !input.filed) return { kind: "none" };
  const narrowed = narrowDocuments(input.text, input.pending);
  if (narrowed.length === 1) return { kind: "pending", proposal: narrowed[0] };
  if (narrowed.length > 1) {
    return { kind: "ask", question: whichDocumentQuestion(narrowed) };
  }
  if (input.filed) return { kind: "filed", proposal: input.filed };
  return { kind: "none" };
}

function narrowDocuments(text: string, docs: DocumentProposalState[]): DocumentProposalState[] {
  if (docs.length <= 1) return docs;
  const namedChild = docs.filter(
    (doc) => doc.childName && new RegExp(`\\b${escapeRegExp(doc.childName)}\\b`, "i").test(text)
  );
  const pool = namedChild.length > 0 ? namedChild : docs;
  const evaluation = /\bevaluation\b/i.test(text);
  const report = /\breport\b/i.test(text);
  const record = /\brecord\b/i.test(text);
  if (!evaluation && !report && !record) return pool;
  const matched = pool.filter((doc) => {
    const blob = `${doc.title} ${doc.description} ${doc.category}`;
    if (evaluation && /\bevaluation\b/i.test(blob)) return true;
    if (report && /\breport\b/i.test(blob)) return true;
    if (record && /\brecord\b/i.test(blob)) return true;
    return false;
  });
  return matched.length > 0 ? matched : pool;
}

function whichDocumentQuestion(docs: DocumentProposalState[]): string {
  const names = docs.map((doc) => doc.title || "Document").slice(0, 4);
  return `Which document should I update? ${names.join(", or ")}.`;
}

export function documentVisibilityFor(
  category: string,
  text: string
): DocumentVisibility {
  if (/\b(just me|only me|private)\b/i.test(text)) return "private";
  if (/\b(kids can see|family can see|visible to (the )?kids)\b/i.test(text)) return "family";
  if (HEALTH_CATEGORIES.has(category)) return "parents_only";
  if (/\b(medical|therapy|health|legal|court|custody)\b/i.test(text)) return "parents_only";
  return "parents_only";
}

export function attachmentShouldBeCalendar(text: string): boolean {
  return isScheduleRequest(text);
}

function filenameSuggestsFiling(fileName: string): boolean {
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " ");
  return /\b(therapy|evaluation|eval|appointment|medical|record|report|document|letter)\b/i.test(stem);
}

/**
 * An uploaded file follows the parent's filing request.
 * A filename that mentions therapy, evaluation, or a date does not schedule an event.
 */
export function attachmentRouteKind(input: {
  caption: string;
  fileName: string;
  classifyType: "document" | "expense" | "event";
  pendingDocument: boolean;
}): "document" | "expense" | "event" {
  if (attachmentShouldBeCalendar(input.caption) && !isDocumentFilingRequest(input.caption)) return "event";
  if (input.pendingDocument || isDocumentFilingRequest(input.caption) || isDocumentEdit(input.caption)) {
    return "document";
  }
  if (looksLikeSavedRecord(input.fileName) || filenameSuggestsFiling(input.fileName)) return "document";
  if (input.classifyType === "expense") return "expense";
  if (input.classifyType === "event") return "event";
  return "document";
}

export function interpretDocumentTurn(input: {
  text: string;
  fileName?: string | null;
  fileMime?: string | null;
  fileSize?: number | null;
  /** Vault id of a file uploaded on this turn. */
  incomingDocumentId?: string | null;
  children: KnownDocumentChild[];
  pending: DocumentProposalState | null;
  /** Every open document proposal. Used when "this evaluation" could match more than one. */
  pendingDocuments?: DocumentProposalState[];
  filed: DocumentProposalState | null;
  today: Date;
  timezone: string;
}):
  | { action: "none" }
  | { action: "error"; message: string; thread: DocumentThread }
  | { action: "ask"; message: string; thread: DocumentThread }
  | { action: "create" | "revise"; proposal: DocumentProposalState; reply: string } {
  const text = input.text.trim();
  const fileName = input.fileName?.trim() || null;
  if (fileName && input.fileSize != null) {
    const problem = documentFileProblem(fileName, input.fileMime ?? "", input.fileSize);
    if (problem) {
      return {
        action: "error",
        message: problem,
        thread: { pending: input.pending, filed: input.filed },
      };
    }
  }

  const filing = isDocumentFilingRequest(text);
  const pendingOptions = input.pendingDocuments ?? (input.pending ? [input.pending] : []);
  const choice = selectDocumentTarget({
    text,
    pending: pendingOptions,
    filed: input.filed,
  });
  if (choice.kind === "ask") {
    return {
      action: "ask",
      message: choice.question,
      thread: { pending: input.pending, filed: input.filed },
    };
  }
  const pending = choice.kind === "pending" ? choice.proposal : input.pending;
  const filed = choice.kind === "filed" ? choice.proposal : input.filed;
  const edit = choice.kind === "pending" || choice.kind === "filed" || isDocumentEdit(text);
  const fromFile = fileName ? kindFromFileName(fileName) : null;
  const hasDocumentContext = Boolean(pending || filed || filing || fromFile);
  if (!hasDocumentContext) return { action: "none" };
  if (!filing && !edit && !fileName) return { action: "none" };
  if (isScheduleRequest(text) && !filing) return { action: "none" };

  const parsedFromText = parseFiling(text, input.children);
  const parsed = parsedFromText ?? (!pending && fromFile ? filingFromKind(fromFile, input.children, fileName) : null);
  if (!parsed && !pending && !(edit && filed)) return { action: "none" };

  const next = mergeProposal({
    pending,
    filed,
    parsed,
    text,
    fileName,
    children: input.children,
    incomingDocumentId: fileName ? input.incomingDocumentId ?? pending?.documentId ?? "pending-file" : null,
    today: input.today,
    timezone: input.timezone,
    edit,
  });
  if (!next) return { action: "none" };

  const revising = Boolean(pending) && next.key === pending?.key;
  const unread = fileName != null && !documentCanBeRead(fileName, input.fileMime ?? "");
  return {
    action: revising ? "revise" : "create",
    proposal: next,
    reply: revising
      ? "I updated the document waiting for your approval. Nothing is filed until you approve it."
      : next.updatesExisting
        ? "I can update the filed document. Nothing changes until you approve it."
        : unread
          ? "I can save this file in Documents once you approve it. I haven't read its contents."
          : "I can file that document once you approve it.",
  };
}

export function applyDocumentTurn(
  thread: DocumentThread,
  turn: {
    text?: string;
    fileName?: string | null;
    fileMime?: string | null;
    fileSize?: number | null;
    incomingDocumentId?: string | null;
  },
  children: KnownDocumentChild[],
  today: Date,
  timezone: string
): {
  thread: DocumentThread;
  open: DocumentProposalState[];
  error: string | null;
  reply: string;
  calendar: false;
} {
  const interpreted = interpretDocumentTurn({
    text: turn.text ?? "",
    fileName: turn.fileName,
    fileMime: turn.fileMime,
    fileSize: turn.fileSize,
    incomingDocumentId: turn.incomingDocumentId,
    children,
    pending: thread.pending,
    filed: thread.filed,
    today,
    timezone,
  });
  if (interpreted.action === "none") {
    return { thread, open: openDocuments(thread), error: null, reply: "", calendar: false };
  }
  if (interpreted.action === "error" || interpreted.action === "ask") {
    return {
      thread: interpreted.thread,
      open: openDocuments(interpreted.thread),
      error: interpreted.action === "ask" ? null : interpreted.message,
      reply: interpreted.message,
      calendar: false,
    };
  }
  const pending = interpreted.proposal;
  return {
    thread: { ...thread, pending },
    open: [pending],
    error: null,
    reply: interpreted.reply,
    calendar: false,
  };
}

export function openDocuments(thread: DocumentThread): DocumentProposalState[] {
  return thread.pending ? [thread.pending] : [];
}

function looksLikeSavedRecord(fileName: string): boolean {
  return /\b(eval(?:uation)?|report|record|document|letter)\b/i.test(fileName.replace(/[._-]+/g, " "));
}

function kindFromFileName(fileName: string): KindRule | null {
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " ");
  return KIND_RULES.find((rule) => rule.re.test(stem)) ?? null;
}

function filingFromKind(
  rule: KindRule,
  children: KnownDocumentChild[],
  fileName: string | null
): ParsedFiling {
  const child = matchChild(`${fileName ?? ""} `, children);
  return {
    ...rule,
    child,
    visibility: documentVisibilityFor(rule.category, ""),
  };
}

type ParsedFiling = KindRule & {
  child: KnownDocumentChild | null;
  visibility: DocumentVisibility;
};

function parseFiling(text: string, children: KnownDocumentChild[]): ParsedFiling | null {
  if (!isDocumentFilingRequest(text) && !isDocumentEdit(text)) return null;
  const rule =
    KIND_RULES.find((item) => item.re.test(text)) ??
    (/\bmedical\b/i.test(text)
      ? {
          re: /\bmedical\b/i,
          label: "Medical Document",
          sentence: "Medical document",
          category: "medical",
        }
      : /\bemail\b/i.test(text)
        ? {
            re: /\bemail\b/i,
            label: "Forwarded Email",
            sentence: "Email saved as a document",
            category: "communication",
          }
        : {
            re: /$^/,
            label: "Document",
            sentence: "Document",
            category: "other",
          });
  if (!isDocumentFilingRequest(text)) return null;
  return {
    ...rule,
    child: matchChild(text, children),
    visibility: documentVisibilityFor(rule.category, text),
  };
}

function matchChild(text: string, children: KnownDocumentChild[]): KnownDocumentChild | null {
  const hit = children.filter((child) => new RegExp(`\\b${escapeRegExp(child.name)}\\b`, "i").test(text));
  return hit.length === 1 ? hit[0] : null;
}

function mergeProposal(input: {
  pending: DocumentProposalState | null;
  filed: DocumentProposalState | null;
  parsed: ParsedFiling | null;
  text: string;
  fileName: string | null;
  children: KnownDocumentChild[];
  incomingDocumentId: string | null;
  today: Date;
  timezone: string;
  edit: boolean;
}): DocumentProposalState | null {
  if (input.pending && input.fileName && !input.parsed && !input.edit) {
    const upgraded = upgradeWeakDocument(input.pending, input.fileName, input.children);
    return {
      ...input.pending,
      ...upgraded,
      fileName: input.fileName,
      documentId: input.incomingDocumentId ?? input.pending.documentId,
    };
  }

  const updatingFiled = !input.pending && Boolean(input.filed) && input.edit;
  const source = input.pending ?? (updatingFiled ? input.filed : null);
  const parsed = input.parsed;
  if (!parsed && !source) return null;
  const namedFile = input.fileName ?? source?.fileName ?? null;
  const fromName = namedFile ? kindFromFileName(namedFile) : null;
  const weakTitle = source ? titleIsFileName(source.title, namedFile) : false;
  const child =
    parsed?.child ??
    (source?.childId && source.childName
      ? { id: source.childId, name: source.childName }
      : null) ??
    matchChild(`${input.text} ${namedFile ?? ""}`, input.children);
  const category =
    parsed?.category && parsed.category !== "other"
      ? parsed.category
      : source?.category && source.category !== "other"
        ? source.category
        : fromName?.category ?? parsed?.category ?? source?.category ?? "other";
  const visibility = parsed?.visibility ?? source?.visibility ?? documentVisibilityFor(category, input.text);
  const label =
    parsed?.label ??
    (weakTitle ? fromName?.label : source?.title.replace(/^.* — /, "")) ??
    fromName?.label ??
    "Document";
  const sentence = parsed?.sentence ?? fromName?.sentence ?? "Document";
  const title = child ? `${child.name} — ${label}` : label;
  let description = child ? `${sentence} for ${child.name}` : sentence;
  if (source?.description && !parsed && !titleIsFileName(source.description, namedFile)) {
    description = source.description;
  }
  const completed = input.edit ? completedPhrase(input.text, input.today, input.timezone) : null;
  if (completed && !description.includes(completed)) {
    const base = description.replace(/\.$/, "").trim();
    description = base ? `${base}. ${completed}` : completed;
  }
  const key = input.pending?.key ?? (updatingFiled ? `update-${input.filed?.documentId ?? "filed"}` : "pending-document");
  return {
    key,
    title: title.slice(0, 120),
    description: description.slice(0, 600),
    category,
    visibility,
    childName: child?.name ?? null,
    childId: child?.id ?? null,
    fileName: input.fileName ?? source?.fileName ?? null,
    documentId: input.fileName
      ? input.incomingDocumentId ?? source?.documentId ?? null
      : source?.documentId ?? null,
    requiresApproval: true,
    updatesExisting: updatingFiled,
  };
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function completedPhrase(text: string, today: Date, timezone: string): string | null {
  if (!/\b(completed|include that|description)\b/i.test(text)) return null;
  const named = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+((?:19|20)\d{2}))?\b/i
  );
  const numeric = named ? null : text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-]((?:19|20)?\d{2}))?\b/);
  if (!named && !numeric) return null;
  const monthIndex = named ? MONTHS.indexOf(named[1].toLowerCase()) : Number(numeric?.[1]) - 1;
  const day = Number(named ? named[2] : numeric?.[2]);
  const statedYear = named?.[3] ?? numeric?.[3] ?? null;
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(today);
  let year = statedYear ? Number(statedYear.length === 2 ? `20${statedYear}` : statedYear) : Number(todayIso.slice(0, 4));
  const month = String(monthIndex + 1).padStart(2, "0");
  const dayText = String(day).padStart(2, "0");
  if (!statedYear && `${year}-${month}-${dayText}` > todayIso) year -= 1;
  const candidate = new Date(Date.UTC(year, monthIndex, day, 12));
  if (candidate.getUTCMonth() !== monthIndex || candidate.getUTCDate() !== day) return null;
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(candidate);
  return `Completed ${label}.`;
}

function upgradeWeakDocument(
  pending: DocumentProposalState,
  fileName: string,
  children: KnownDocumentChild[]
): Pick<DocumentProposalState, "title" | "description" | "category" | "childId" | "childName" | "visibility"> {
  const rule = kindFromFileName(fileName);
  const child =
    pending.childId && pending.childName
      ? { id: pending.childId, name: pending.childName }
      : matchChild(`${pending.title} ${pending.description} ${fileName}`, children);
  const weakTitle = titleIsFileName(pending.title, fileName);
  const label = weakTitle ? rule?.label ?? pending.title : pending.title.replace(/^.* — /, "");
  const title = child && rule ? `${child.name} — ${label}` : weakTitle ? label : pending.title;
  const sentence = rule?.sentence ?? "Document";
  const description =
    pending.description.trim() && !titleIsFileName(pending.description, fileName)
      ? pending.description
      : child
        ? `${sentence} for ${child.name}`
        : sentence;
  const category = pending.category !== "other" ? pending.category : rule?.category ?? pending.category;
  return {
    title,
    description,
    category,
    childId: child?.id ?? pending.childId,
    childName: child?.name ?? pending.childName,
    visibility: pending.visibility,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type DocumentRevision = {
  key: string;
  title: string;
  description: string;
  category: string;
  visibility: DocumentVisibility;
  childId: string | null;
  childName: string | null;
  fileName: string | null;
  documentId: string | null;
  updatesExisting: boolean;
};

export function revisionFromProposal(doc: DocumentProposalState): DocumentRevision {
  return {
    key: doc.key,
    title: doc.title,
    description: doc.description,
    category: doc.category,
    visibility: doc.visibility,
    childId: doc.childId,
    childName: doc.childName,
    fileName: doc.fileName,
    documentId: doc.documentId,
    updatesExisting: doc.updatesExisting,
  };
}

/** Supersede the open document proposal and keep one current version. */
export function applyRevisionToProposals(
  proposals: unknown[],
  revision: DocumentRevision
): { proposals: unknown[]; changed: boolean } {
  const index = openDocumentIndex(proposals, revision.key);
  if (index < 0) return { proposals, changed: false };
  const revised = reviseProposal(proposals, index, {
    type: "log_document",
    key: revision.key,
    title: revision.title,
    description: revision.description,
    category: revision.category,
    visibility: revision.visibility,
    requires_approval: true,
    draft: `File “${revision.title}”. ${revision.description}`,
    document_child_id: revision.childId,
    document_child_name: revision.childName,
    updatesExisting: revision.updatesExisting,
    ...(revision.fileName ? { attached_file_name: revision.fileName } : {}),
    ...(revision.documentId ? { attached_document_id: revision.documentId } : {}),
  });
  if (!revised) return { proposals, changed: false };
  return { proposals: revised.proposals, changed: true };
}

function openDocumentIndex(proposals: unknown[], key: string): number {
  let fallback = -1;
  for (let i = proposals.length - 1; i >= 0; i -= 1) {
    const raw = proposals[i];
    if (!raw || typeof raw !== "object") continue;
    const current = raw as { type?: string; key?: string };
    if (current.type !== "log_document" && current.type !== "file_document") continue;
    if (isInactiveProposal(current)) continue;
    if (fallback < 0) fallback = i;
    if (current.key && key && current.key === key) return i;
  }
  return fallback;
}
