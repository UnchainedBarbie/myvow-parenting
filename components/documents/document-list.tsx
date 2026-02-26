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

export function DocumentList({ documents }: DocumentListProps) {
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
          <ul className="space-y-3">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className={cn(
                  "rounded-card border border-border bg-background-secondary/50 p-4 shadow-card"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">
                      {doc.file_name}
                    </p>
                    <p className="text-sm text-foreground-secondary mt-0.5">
                      {CATEGORY_LABELS[doc.category] ?? doc.category}
                      {doc.child_name && ` · ${doc.child_name}`}
                      {doc.description && ` · ${doc.description}`}
                    </p>
                  </div>
                  <div className="text-right text-sm text-foreground-secondary">
                    <p>{formatDate(doc.created_at)}</p>
                    <p>{formatSize(doc.file_size_bytes)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
