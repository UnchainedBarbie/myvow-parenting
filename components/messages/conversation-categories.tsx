"use client";

import { useEffect, useState } from "react";
import { RECORD_CATEGORIES, type RecordCategoryId } from "@/lib/record/record-categories";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";

export function ConversationCategories({ conversationId }: { conversationId: string }) {
  const [available, setAvailable] = useState(true);
  const [selected, setSelected] = useState<RecordCategoryId[]>([]);
  const [saved, setSaved] = useState<RecordCategoryId[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/messages/conversations/${conversationId}/categories`)
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          categories?: RecordCategoryId[];
          available?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "Could not load categories.");
        if (cancelled) return;
        const categories = Array.isArray(data.categories) ? data.categories : [];
        setAvailable(data.available !== false);
        setSelected(categories);
        setSaved(categories);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          showErrorToast(error instanceof Error ? error.message : "Could not load categories.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  function toggle(id: RecordCategoryId) {
    setSelected((current) =>
      current.includes(id) ? current.filter((category) => category !== id) : [...current, id]
    );
  }

  const dirty =
    selected.length !== saved.length || selected.some((category) => !saved.includes(category));

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`/api/messages/conversations/${conversationId}/categories`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: selected }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        categories?: RecordCategoryId[];
        available?: boolean;
        error?: string;
      };
      if (!response.ok) {
        if (data.available === false) setAvailable(false);
        throw new Error(data.error ?? "Could not save categories.");
      }
      const categories = Array.isArray(data.categories) ? data.categories : selected;
      setSelected(categories);
      setSaved(categories);
      showSuccessToast("Categories saved.");
    } catch (error: unknown) {
      showErrorToast(error instanceof Error ? error.message : "Could not save categories.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="mt-2 space-y-1.5" disabled={loading || !available || saving}>
      <legend className="text-[11px] font-medium text-[#5B7A52]">Categories</legend>
      {available ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {RECORD_CATEGORIES.map((category) => {
            const inputId = `conversation-category-${conversationId}-${category.id}`;
            return (
              <label key={category.id} htmlFor={inputId} className="inline-flex items-center gap-1.5 text-[11px] text-[#3D3D3D]">
                <input
                  id={inputId}
                  type="checkbox"
                  checked={selected.includes(category.id)}
                  onChange={() => toggle(category.id)}
                  className="h-3.5 w-3.5 rounded border-[#E8E4DC] text-[#5B7A52] focus:ring-[#5B7A52]"
                />
                {category.label}
              </label>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-[#8A8A8A]">
          Categories can be assigned after the conversation categories update is applied in the database.
        </p>
      )}
      {available ? (
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving || loading}
          className="h-7 rounded-full bg-[#5B7A52] px-3 text-[11px] text-white hover:bg-[#476242] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save categories"}
        </button>
      ) : null}
    </fieldset>
  );
}
