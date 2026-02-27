"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  medical: "Medical",
  school: "School",
  legal: "Legal",
  therapy: "Therapy",
  financial: "Financial",
  custody: "Custody",
  other: "Other",
};

export type DocumentRow = {
  id: string;
  file_name: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  category: string;
  child_id: string | null;
  child_name: string | null;
  description: string | null;
  created_at: string;
};

interface DocumentListProps {
  documents: DocumentRow[];
}

function formatDate(createdAt: string) {
  return new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatSize(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type SortKey = "docId" | "file_name" | "category" | "child_name" | "description" | "created_at" | "file_size_bytes";

export function DocumentList({ documents }: DocumentListProps) {
  // Derive a stable display ID like DOC-001, DOC-002 based on created_at descending.
  const sortedByCreated = [...documents].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const withDocId = sortedByCreated.map((doc, index) => ({
    ...doc,
    docId: `DOC-${String(index + 1).padStart(3, "0")}`,
  }));

  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "created_at" ? "desc" : "asc");
    }
  }

  const sorted = [...withDocId].sort((a, b) => {
    let av: any;
    let bv: any;
    switch (sortKey) {
      case "docId":
        av = a.docId;
        bv = b.docId;
        break;
      case "file_name":
      case "category":
      case "child_name":
      case "description":
        av = (a[sortKey] ?? "").toString().toLowerCase();
        bv = (b[sortKey] ?? "").toString().toLowerCase();
        break;
      case "created_at":
        av = new Date(a.created_at).getTime();
        bv = new Date(b.created_at).getTime();
        break;
      case "file_size_bytes":
        av = a.file_size_bytes ?? 0;
        bv = b.file_size_bytes ?? 0;
        break;
      default:
        av = 0;
        bv = 0;
    }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const sortIndicator = (key: SortKey) =>
    key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="font-heading text-lg">All documents</CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-foreground-secondary py-6">
            No documents yet. Upload one above.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border bg-background-secondary/40">
            <table className="min-w-full text-sm">
              <thead className="bg-background-secondary/80 text-foreground-secondary">
                <tr>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer"
                    onClick={() => handleSort("docId")}
                  >
                    Doc ID{sortIndicator("docId")}
                  </th>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer"
                    onClick={() => handleSort("file_name")}
                  >
                    File Name{sortIndicator("file_name")}
                  </th>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer"
                    onClick={() => handleSort("category")}
                  >
                    Category{sortIndicator("category")}
                  </th>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer"
                    onClick={() => handleSort("child_name")}
                  >
                    Child{sortIndicator("child_name")}
                  </th>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer"
                    onClick={() => handleSort("description")}
                  >
                    Description{sortIndicator("description")}
                  </th>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer"
                    onClick={() => handleSort("created_at")}
                  >
                    Date Uploaded{sortIndicator("created_at")}
                  </th>
                  <th
                    className="px-3 py-2 text-right font-medium cursor-pointer"
                    onClick={() => handleSort("file_size_bytes")}
                  >
                    File Size{sortIndicator("file_size_bytes")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((doc, idx) => (
                  <tr
                    key={doc.id}
                    className={cn(
                      "border-t border-border",
                      idx % 2 === 0 ? "bg-background" : "bg-background-secondary/40"
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-foreground-secondary">
                      {doc.docId}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {doc.file_name}
                    </td>
                    <td className="px-3 py-2 text-foreground-secondary">
                      {CATEGORY_LABELS[doc.category] ?? doc.category}
                    </td>
                    <td className="px-3 py-2 text-foreground-secondary">
                      {doc.child_name ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-foreground-secondary">
                      {doc.description ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-foreground-secondary whitespace-nowrap">
                      {formatDate(doc.created_at)}
                    </td>
                    <td className="px-3 py-2 text-right text-foreground-secondary whitespace-nowrap">
                      {formatSize(doc.file_size_bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
