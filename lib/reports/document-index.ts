import {
  documentCategoryLabel,
  documentVisibilityLabel,
  formatDocumentNumber,
} from "@/lib/documents-tab";
import { supportingEvidenceCell } from "@/lib/reports/evidence-refs";

export type DocumentIndexSource = {
  id: string;
  documentNumber: number | null;
  title: string | null;
  fileName: string;
  category: string;
  childName: string;
  createdAt: string;
  visibility: string;
  conversations: string[];
  uploadedByName: string | null;
  linkedExpenses: string[];
  linkedMessages: string[];
};

export type DocumentIndexOptions = {
  documentList: boolean;
  linkedConversations: boolean;
  includeFiles: boolean;
};

export type DocumentIndexFact = { label: string; value: string };

export type DocumentIndexTable = {
  kind: "table";
  title: string;
  intro?: string;
  headers: string[];
  widths: number[];
  rows: string[][];
  empty: string;
};

export type DocumentIndexLines = {
  kind: "lines";
  title: string;
  lines: string[];
};

export type DocumentIndexDocument = {
  facts: DocumentIndexFact[];
  blocks: Array<DocumentIndexTable | DocumentIndexLines>;
  completeness: string;
  verificationExplanation: string;
};

export function documentIndexOptions(options: Record<string, boolean> | undefined): DocumentIndexOptions {
  return {
    documentList: options?.document_list !== false,
    linkedConversations: options?.linked_conversations !== false,
    includeFiles: options?.include_documents_zip === true,
  };
}

function uploadDate(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(date);
}

export function prepareDocumentIndex(input: {
  documents: DocumentIndexSource[];
  parents: { name: string }[];
  caseLabel: string;
  timeZone: string;
  generatedAt: Date;
  options: DocumentIndexOptions;
  withheldCount: number;
  fileLines: string[];
  linkWarning: string | null;
  evidenceLabels?: Map<string, string> | null;
}): { includedCount: number; verificationPayload: string; document: DocumentIndexDocument } {
  const sorted = [...input.documents].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

  const headers = ["Document ID", "Title", "Original filename", "Category", "Child", "Upload date", "Uploaded by", "Visibility", "Linked records", "Supporting evidence"];
  const widths = [18, 32, 34, 20, 20, 22, 28, 22, 28, 31.4];
  if (input.options.linkedConversations) {
    headers.splice(8, 0, "Linked conversations");
    widths.splice(0, widths.length, 16, 28, 28, 18, 16, 20, 24, 18, 24, 28, 35.4);
  }

  const rows = sorted.map((doc) => {
    const title = doc.title?.trim() || doc.fileName.trim() || "—";
    const id = formatDocumentNumber(doc.documentNumber);
    const links = [
      ...doc.linkedExpenses,
      ...doc.linkedMessages,
    ];
    const includePages = input.evidenceLabels != null && input.options.includeFiles;
    const evidence =
      (includePages ? input.evidenceLabels?.get(id) : null) ??
      supportingEvidenceCell({
        linked: true,
        documentLabel: id === "—" ? null : id,
        includeFiles: includePages,
        pageLabel: null,
        unavailable: false,
      });
    const row = [
      id,
      title,
      doc.fileName.trim() || "—",
      documentCategoryLabel(doc.category),
      doc.childName.trim() || "All children",
      uploadDate(doc.createdAt, input.timeZone),
      doc.uploadedByName?.trim() || "Not recorded",
      documentVisibilityLabel(doc.visibility),
    ];
    if (input.options.linkedConversations) {
      row.push(doc.conversations.length > 0 ? doc.conversations.join("; ") : "No linked conversation stored");
    }
    row.push(links.length > 0 ? links.join("; ") : "No linked expense or message stored");
    row.push(evidence);
    return row;
  });

  const payload = sorted.map((doc) =>
    [
      doc.id,
      doc.documentNumber ?? "",
      doc.createdAt,
      doc.fileName,
      doc.category,
      doc.visibility,
      input.options.linkedConversations ? doc.conversations.join(";") : "",
    ].join("~")
  );

  const generatedLabel = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: input.timeZone,
  }).format(input.generatedAt);

  const sectionNames: string[] = [];
  if (input.options.documentList) sectionNames.push("Document list");
  if (input.options.includeFiles) sectionNames.push("Document files");

  const blocks: DocumentIndexDocument["blocks"] = [];
  if (input.options.documentList) {
    blocks.push({
      kind: "table",
      title: "Documents",
      intro: "Columns match the Documents tab, with the parent who uploaded the file when that name is stored. Linked records use saved expense receipts and message links. Calendar events are not stored as document links, so this index does not assign event IDs. The list is ordered by upload date, newest first.",
      headers,
      widths,
      rows,
      empty: "No documents are available to include.",
    });
  }
  if (input.options.includeFiles) {
    blocks.push({
      kind: "lines",
      title: "Document files",
      lines:
        input.fileLines.length > 0
          ? [
              "Document files follow this index in the same order as the table. A file linked to more than one record is included once, and every record number is listed on its page.",
              ...input.fileLines,
            ]
          : ["No document files are available to append."],
    });
  }
  if (input.linkWarning) {
    blocks.push({
      kind: "lines",
      title: "Linked conversations",
      lines: [input.linkWarning],
    });
  }

  const withheld =
    input.withheldCount === 0
      ? "No documents were withheld."
      : `${input.withheldCount} document${input.withheldCount === 1 ? "" : "s"} ${input.withheldCount === 1 ? "is" : "are"} omitted because ${input.withheldCount === 1 ? "its visibility does" : "their visibility does"} not include the person who generated this report. ${input.withheldCount === 1 ? "Its title and file are" : "Their titles and files are"} not listed.`;

  return {
    includedCount: sorted.length,
    verificationPayload: payload.join("|"),
    document: {
      facts: [
        { label: "Case", value: input.caseLabel || "Not recorded" },
        {
          label: "Parties",
          value: input.parents.length > 0 ? input.parents.map((parent) => parent.name).join("; ") : "Not recorded",
        },
        { label: "Generated", value: generatedLabel },
        { label: "Sections", value: sectionNames.length > 0 ? sectionNames.join("; ") : "None selected" },
      ],
      blocks,
      completeness: `This report includes ${sorted.length} document${sorted.length === 1 ? "" : "s"} from the Documents tab that this person is allowed to access. ${withheld}`,
      verificationExplanation:
        "This SHA-256 hash covers the included document identifiers, numbers, upload times, file names, categories, and visibility. It does not cover file bytes. It is not an independent certification. Unavailable files stay listed in Supporting evidence.",
    },
  };
}
