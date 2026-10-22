import { documentAuthorizedForViewer } from "@/lib/documents-tab";

export type SearchableDocument = {
  id: string;
  title: string;
  description: string;
  category: string;
  fileName: string;
  childIds: string[];
  createdAt: string;
  visibility: string;
  uploadedBy: string;
};

export type DocumentSearchChild = { id: string; name: string };

export type DocumentViewer = { userId: string; role: string | null | undefined };

export type DocumentLink = { id: string; label: string };

const ASKING = /\b(find|show|where|search|pull up|look up|do (?:i|we) have)\b/i;
const ABOUT =
  /\b(document|documents|record|records|evaluation|report|file|files|medical|therapy|\bot\b|school)\b/i;
const KIND = /\b(evaluation|report|record|records|document|documents)\b/i;
const GENERIC_FILE = /\b(file|files|document|documents)\b/i;

export function isDocumentQuestion(text: string): boolean {
  const message = text.trim();
  if (!message) return false;
  if (/\b(save|file|store|upload)\b/i.test(message) && /\b(document|documents|record|records|evaluation|report)\b/i.test(message)) {
    return false;
  }
  if (/\b(add|put|schedule|book)\b/i.test(message) && /\b(calendar|appointment)\b/i.test(message)) {
    return false;
  }
  return ASKING.test(message) && ABOUT.test(message);
}

export function visibleDocuments(
  documents: SearchableDocument[],
  viewer: DocumentViewer
): SearchableDocument[] {
  return documents.filter((doc) =>
    documentAuthorizedForViewer(
      { visibility: doc.visibility, uploadedBy: doc.uploadedBy },
      viewer
    )
  );
}

export function answerDocumentQuestion(input: {
  message: string;
  documents: SearchableDocument[];
  children: DocumentSearchChild[];
  today: Date;
  timezone: string;
  viewer?: DocumentViewer;
}): string | null {
  if (!isDocumentQuestion(input.message)) return null;
  const named = namedChildren(input.message, input.children);
  if (named.length > 1) {
    const list = named.map((child) => child.name).join(" and ");
    return `Which ${list} do you mean?`;
  }
  const unknown = unknownChildName(input.message, input.children);
  if (named.length === 0 && unknown) {
    return `I don't see a child named ${unknown} on this case.`;
  }
  const child = named[0] ?? null;
  const documents = input.viewer ? visibleDocuments(input.documents, input.viewer) : input.documents;
  const window = uploadedWindow(input.message, input.today, input.timezone);
  const need = specificNeed(input.message);
  const matches = documents
    .filter((doc) => (child ? doc.childIds.includes(child.id) : true))
    .filter((doc) => (window ? inWindow(doc.createdAt, input.timezone, window) : true))
    .filter((doc) => documentMatches(doc, input.message, need))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const list = wantsList(input.message);
  const shown = matches.slice(0, list ? 5 : 1);
  if (shown.length === 0) {
    return "I couldn't find a saved document that matches that.";
  }
  const lines = shown.map((doc) => {
    const when = formatSaved(doc.createdAt, input.timezone);
    return `${doc.title || "Document"}${when ? ` (saved ${when})` : ""}`;
  });
  const reply =
    shown.length === 1
      ? `${lines[0]} is the most recent match.`
      : `I found ${shown.length} matching documents:\n${lines.map((line) => `- ${line}`).join("\n")}`;
  return withDocumentLinks(
    reply,
    shown.map((doc) => ({ id: doc.id, label: doc.title || "Document" }))
  );
}

export function pickSavedForEdit(
  message: string,
  documents: SearchableDocument[],
  children: DocumentSearchChild[]
):
  | { kind: "none" }
  | { kind: "ask"; question: string }
  | { kind: "one"; document: SearchableDocument } {
  if (!/\b(evaluation|document|record|report|file)\b/i.test(message)) return { kind: "none" };
  const named = namedChildren(message, children);
  const need = specificNeed(message);
  const matches = documents
    .filter((doc) => (named.length === 1 ? doc.childIds.includes(named[0].id) : true))
    .filter((doc) => documentMatches(doc, message, need));
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) return { kind: "one", document: matches[0] };
  const names = matches.slice(0, 4).map((doc) => doc.title || "Document");
  return { kind: "ask", question: `Which document should I update? ${names.join(", or ")}.` };
}

export function splitDocumentAnswer(content: string): { text: string; links: DocumentLink[] } {
  const links: DocumentLink[] = [];
  const text = content
    .replace(/\[\[doc:([^\]|]+)\|([^\]]+)\]\]/g, (_match, id: string, label: string) => {
      const documentId = id.trim();
      const name = label.trim();
      if (documentId && name) links.push({ id: documentId, label: name });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, links };
}

function withDocumentLinks(reply: string, links: DocumentLink[]): string {
  if (links.length === 0) return reply;
  const markers = links.map((link) => `[[doc:${link.id}|${link.label}]]`);
  return `${reply}\n${markers.join("\n")}`;
}

function wantsList(message: string): boolean {
  if (/\b(most recent|latest|last)\b/i.test(message)) return false;
  return /\b(records|documents|files)\b/i.test(message);
}

function specificNeed(message: string): "ot" | "medical" | "school" | "therapy" | null {
  if (/\b(?:occupational therapy|\bot\b)/i.test(message)) return "ot";
  if (/\bmedical\b/i.test(message)) return "medical";
  if (/\bschool\b/i.test(message)) return "school";
  if (/\btherapy\b/i.test(message)) return "therapy";
  return null;
}

function documentMatches(
  doc: SearchableDocument,
  message: string,
  need: "ot" | "medical" | "school" | "therapy" | null
): boolean {
  if (need && !matchesNeed(doc, need)) return false;
  const generic =
    GENERIC_FILE.test(message) &&
    !need &&
    !/\b(evaluation|report|record|records)\b/i.test(message);
  if (generic) return true;
  if (!KIND.test(message)) return need != null;
  const blob = blobOf(doc);
  if (/\b(evaluation|report|record|document)\b/i.test(blob)) return true;
  if (need === "medical" && (doc.category === "medical" || doc.category === "therapy")) return true;
  if (need === "school" && doc.category === "school") return true;
  if (need === "therapy" && doc.category === "therapy") return true;
  return false;
}

function matchesNeed(doc: SearchableDocument, need: "ot" | "medical" | "school" | "therapy"): boolean {
  const blob = blobOf(doc);
  if (need === "ot") return /\boccupational therapy\b|\bot\b/i.test(blob);
  if (need === "medical") {
    return doc.category === "medical" || doc.category === "therapy" || /\bmedical\b/i.test(blob);
  }
  if (need === "school") return doc.category === "school" || /\bschool\b/i.test(blob);
  return doc.category === "therapy" || /\btherapy\b/i.test(blob);
}

function blobOf(doc: SearchableDocument): string {
  return `${doc.title} ${doc.description} ${doc.category} ${doc.fileName}`;
}

function namedChildren(message: string, children: DocumentSearchChild[]): DocumentSearchChild[] {
  return children.filter((child) => new RegExp(`\\b${escapeRegExp(child.name)}\\b`, "i").test(message));
}

function unknownChildName(message: string, children: DocumentSearchChild[]): string | null {
  const match = message.match(/\b([A-Z][a-z]{1,20})'s\b/);
  if (!match) return null;
  const name = match[1];
  if (children.some((child) => child.name.toLowerCase() === name.toLowerCase())) return null;
  return name;
}

function uploadedWindow(
  message: string,
  today: Date,
  timezone: string
): { since: string; until: string } | null {
  if (!/\b(last week|past week|this week)\b/i.test(message)) return null;
  const until = ymdInZone(today.toISOString(), timezone);
  if (!until) return null;
  return { since: addDays(until, -7), until };
}

function inWindow(createdAt: string, timezone: string, window: { since: string; until: string }): boolean {
  const day = ymdInZone(createdAt, timezone);
  if (!day) return false;
  return day >= window.since && day <= window.until;
}

function ymdInZone(iso: string, timezone: string): string | null {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
  return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : null;
}

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day + days, 12));
  return dt.toISOString().slice(0, 10);
}

function formatSaved(iso: string, timezone: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dt);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
