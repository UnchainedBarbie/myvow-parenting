"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCategoryColor } from "@/lib/categoryColors";

type KidDocument = {
  id: string;
  title: string | null;
  category: string | null;
  created_at: string;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function KidsDocumentsPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<KidDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/kids/documents");
        const data = (await res.json().catch(() => ({}))) as {
          documents?: KidDocument[];
          message?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 401) {
            router.push("/kids/login");
            return;
          }
          setError(data.message ?? "Could not load documents.");
          return;
        }
        setDocs(data.documents ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleDownload(id: string) {
    setDownloadingId(id);
    try {
      const res = await fetch(`/api/kids/documents/${id}/download`);
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        message?: string;
      };
      if (!res.ok || !data.url) {
        setError(data.message ?? "Could not start download.");
        return;
      }
      window.open(data.url, "_blank");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="w-full max-w-xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-full text-xs"
          onClick={() => router.push("/kids")}
        >
          ← Back
        </Button>
        <h1 className="font-heading text-lg text-[#3D3D3D]">
          Family documents
        </h1>
        <div className="w-16" />
      </div>

      <Card className="border border-[#E8E4DC] bg-white/80 shadow-sm rounded-2xl">
        <div className="px-4 py-3 border-b border-[#E8E4DC]">
          <p className="text-sm font-medium text-[#3D3D3D]">
            Things saved for everyone
          </p>
          <p className="text-[11px] text-[#6B6B6B]">
            You can open and read these documents, but you can&apos;t change or
            delete them.
          </p>
        </div>
        <div className="px-4 py-3 space-y-2 max-h-[420px] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-foreground-secondary">Loading…</p>
          ) : error ? (
            <p className="text-sm text-alert">{error}</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-foreground-secondary">
              No family documents yet.
            </p>
          ) : (
            docs.map((doc) => {
              const colors = getCategoryColor(doc.category ?? "other");
              const title = doc.title || "Untitled document";
              const catLabel =
                doc.category && doc.category !== "other"
                  ? doc.category.charAt(0).toUpperCase() +
                    doc.category.slice(1)
                  : "Other";
              return (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 rounded-xl border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold text-[#3D3D3D]">
                      {title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${colors.pillBgClass} ${colors.pillTextClass}`}
                      >
                        {catLabel}
                      </span>
                      <span className="text-[11px] text-[#8A8A8A]">
                        {formatDate(doc.created_at)}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-full text-xs"
                    disabled={downloadingId === doc.id}
                    onClick={() => void handleDownload(doc.id)}
                  >
                    {downloadingId === doc.id ? "Opening…" : "Download"}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}

