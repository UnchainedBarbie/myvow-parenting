"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ChevronRight, ChevronDown, FileText, Image, Trash2, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const COURT_ORDER_TYPES = [
  { value: "parenting_plan", label: "Parenting Plan" },
  { value: "custody_order", label: "Custody Order" },
  { value: "modification", label: "Modification" },
  { value: "restraining_order", label: "Restraining Order" },
  { value: "financial_order", label: "Financial Order" },
  { value: "other", label: "Other" },
] as const;

const ACCEPT = "image/*,.pdf,application/pdf";
const ACCEPT_LABEL = "PDF, JPG, PNG";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function CollapsibleCard({
  open,
  onToggle,
  title,
  children: content,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader
        className="pb-2 px-4 pt-4 flex flex-row items-center gap-2 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-card"
        onClick={onToggle}
      >
        {open ? (
          <ChevronDown className="h-5 w-5 text-foreground-secondary shrink-0" />
        ) : (
          <ChevronRight className="h-5 w-5 text-foreground-secondary shrink-0" />
        )}
        <CardTitle className="font-heading text-lg text-foreground">{title}</CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4 pt-0 overflow-hidden transition-all">
          {content}
        </CardContent>
      )}
    </Card>
  );
}

export type CourtOrderRow = Record<string, unknown> & {
  id?: string;
  document_type?: string;
  title?: string;
  effective_date?: string | null;
  case_number?: string | null;
  jurisdiction?: string | null;
  description?: string | null;
};

export type ProfileContentProps = {
  profile: { full_name?: string | null; email?: string | null } | null;
  userEmail: string | null;
  children: { id: string; first_name: string; date_of_birth: string | null }[];
  custodySplit: number;
  courtOrders: CourtOrderRow[];
};

export function ProfileContent({
  profile,
  userEmail,
  children,
  custodySplit,
  courtOrders,
}: ProfileContentProps) {
  const router = useRouter();
  const [openYourInfo, setOpenYourInfo] = useState(false);
  const [openChildren, setOpenChildren] = useState(false);
  const [openCaseDetails, setOpenCaseDetails] = useState(false);
  const [openCourtOrders, setOpenCourtOrders] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [showAddCourtOrder, setShowAddCourtOrder] = useState(false);
  const [addFormFile, setAddFormFile] = useState<File | null>(null);
  const [addFormDragActive, setAddFormDragActive] = useState(false);
  const [addFormType, setAddFormType] = useState<string>("parenting_plan");
  const [addFormCaseNumber, setAddFormCaseNumber] = useState("");
  const [addFormJurisdiction, setAddFormJurisdiction] = useState("");
  const [addFormEffectiveDate, setAddFormEffectiveDate] = useState("");
  const [addFormDescription, setAddFormDescription] = useState("");
  const [addFormAnalyzing, setAddFormAnalyzing] = useState(false);
  const [addFormSuggested, setAddFormSuggested] = useState(false);
  const addFormFileRef = useRef<HTMLInputElement>(null);

  // Children section: add form
  const [showAddChildForm, setShowAddChildForm] = useState(false);
  const [addChildFirstName, setAddChildFirstName] = useState("");
  const [addChildDob, setAddChildDob] = useState("");
  const [addChildSaving, setAddChildSaving] = useState(false);
  const [addChildError, setAddChildError] = useState<string | null>(null);
  // Children section: edit
  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [editChildFirstName, setEditChildFirstName] = useState("");
  const [editChildDob, setEditChildDob] = useState("");
  const [editChildSaving, setEditChildSaving] = useState(false);
  const [editChildError, setEditChildError] = useState<string | null>(null);
  // Children section: delete
  const [deletingChildId, setDeletingChildId] = useState<string | null>(null);

  function handleAddFormFileSelect(file: File | null) {
    if (!file) {
      setAddFormFile(null);
      setAddFormSuggested(false);
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
    if (!allowed.some((t) => file.type === t || file.type.startsWith("image/"))) return;
    setAddFormFile(file);
    setAddFormAnalyzing(true);
    setAddFormSuggested(false);
    const formData = new FormData();
    formData.set("file", file);
    fetch("/api/inbox/classify", { method: "POST", body: formData })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) return;
        const p = data as {
          ai_title?: string; ai_description?: string; ai_date?: string; ai_category?: string; ai_location?: string;
          title?: string; description?: string; date?: string; category?: string; location?: string;
        };
        const title = p.ai_title ?? p.title;
        const desc = p.ai_description ?? p.description;
        const date = p.ai_date ?? p.date;
        const category = (p.ai_category ?? p.category ?? "").toLowerCase();
        const location = p.ai_location ?? p.location;
        if (title) setAddFormCaseNumber((prev) => prev || (title ?? ""));
        if (desc) setAddFormDescription((prev) => prev || (desc ?? ""));
        if (date) setAddFormEffectiveDate((prev) => prev || String(date).slice(0, 10));
        if (location) setAddFormJurisdiction((prev) => prev || (location ?? ""));
        if (category) {
          const docType = category.includes("court") || category.includes("order") ? "parenting_plan"
            : category.includes("custody") ? "custody_order"
            : category.includes("modification") ? "modification"
            : category.includes("restrain") ? "restraining_order"
            : category.includes("financial") ? "financial_order"
            : "other";
          setAddFormType(docType);
        }
        setAddFormSuggested(true);
      })
      .catch(() => {})
      .finally(() => setAddFormAnalyzing(false));
  }

  async function handleAddChildSubmit(e: React.FormEvent) {
    e.preventDefault();
    const first = addChildFirstName.trim();
    if (!first) {
      setAddChildError("First name is required");
      return;
    }
    setAddChildError(null);
    setAddChildSaving(true);
    try {
      const res = await fetch("/api/children/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: first,
          date_of_birth: addChildDob || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAddChildError((data as { error?: string }).error ?? "Failed to add child");
        return;
      }
      setShowAddChildForm(false);
      setAddChildFirstName("");
      setAddChildDob("");
      router.refresh();
    } finally {
      setAddChildSaving(false);
    }
  }

  function startEditChild(c: { id: string; first_name: string; date_of_birth: string | null }) {
    setEditingChildId(c.id);
    setEditChildFirstName(c.first_name);
    setEditChildDob(c.date_of_birth ? String(c.date_of_birth).slice(0, 10) : "");
    setEditChildError(null);
  }

  function cancelEditChild() {
    setEditingChildId(null);
    setEditChildError(null);
  }

  async function handleEditChildSave(e: React.FormEvent, childId: string) {
    e.preventDefault();
    const first = editChildFirstName.trim();
    if (!first) {
      setEditChildError("First name is required");
      return;
    }
    setEditChildError(null);
    setEditChildSaving(true);
    try {
      const res = await fetch(`/api/children/${childId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: first,
          date_of_birth: editChildDob || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEditChildError((data as { error?: string }).error ?? "Failed to update");
        return;
      }
      setEditingChildId(null);
      router.refresh();
    } finally {
      setEditChildSaving(false);
    }
  }

  async function handleDeleteChild(childId: string, firstName: string) {
    const ok = window.confirm(`Remove "${firstName}" from your children? This can be undone by contacting support.`);
    if (!ok) return;
    setDeletingChildId(childId);
    try {
      const res = await fetch(`/api/children/${childId}/delete`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert((data as { error?: string }).error ?? "Failed to remove child");
        return;
      }
      router.refresh();
    } finally {
      setDeletingChildId(null);
    }
  }

  return (
    <div className="space-y-6">
      <CollapsibleCard
        open={openYourInfo}
        onToggle={() => setOpenYourInfo((o) => !o)}
        title="Your Info"
      >
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium text-foreground-secondary">Name</label>
            <p className="text-sm text-foreground mt-0.5">{profile?.full_name ?? "—"}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-secondary">Email</label>
            <p className="text-sm text-foreground mt-0.5">{profile?.email ?? userEmail ?? "—"}</p>
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        open={openChildren}
        onToggle={() => setOpenChildren((o) => !o)}
        title="Children"
      >
        <div className="flex flex-col gap-3">
          {!showAddChildForm ? (
            <Button
              size="sm"
              className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white w-fit"
              onClick={() => setShowAddChildForm(true)}
            >
              Add Child
            </Button>
          ) : (
            <form onSubmit={handleAddChildSubmit} className="flex flex-col gap-3 p-3 rounded-lg border border-border bg-muted/20 max-w-sm">
              <div>
                <Label className="text-xs font-medium">First name *</Label>
                <Input
                  className="mt-1 h-9"
                  value={addChildFirstName}
                  onChange={(e) => setAddChildFirstName(e.target.value)}
                  placeholder="First name"
                  required
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Date of birth</Label>
                <Input
                  type="date"
                  className="mt-1 h-9"
                  value={addChildDob}
                  onChange={(e) => setAddChildDob(e.target.value)}
                />
              </div>
              {addChildError && <p className="text-xs text-destructive">{addChildError}</p>}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                  disabled={addChildSaving}
                >
                  {addChildSaving ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full h-8 text-xs"
                  onClick={() => { setShowAddChildForm(false); setAddChildError(null); setAddChildFirstName(""); setAddChildDob(""); }}
                  disabled={addChildSaving}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {children.length === 0 && !showAddChildForm ? (
            <p className="text-sm text-foreground-secondary">No children added yet.</p>
          ) : (
            <ul className="space-y-2">
              {children.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm gap-2">
                  {editingChildId === c.id ? (
                    <form
                      onSubmit={(e) => handleEditChildSave(e, c.id)}
                      className="flex flex-wrap items-end gap-2 flex-1 min-w-0"
                    >
                      <div className="flex-1 min-w-[100px]">
                        <Label className="text-xs font-medium">First name *</Label>
                        <Input
                          className="mt-1 h-8 text-sm"
                          value={editChildFirstName}
                          onChange={(e) => setEditChildFirstName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="w-[120px]">
                        <Label className="text-xs font-medium">Date of birth</Label>
                        <Input
                          type="date"
                          className="mt-1 h-8 text-sm"
                          value={editChildDob}
                          onChange={(e) => setEditChildDob(e.target.value)}
                        />
                      </div>
                      {editChildError && <p className="text-xs text-destructive w-full">{editChildError}</p>}
                      <div className="flex gap-1">
                        <Button type="submit" size="sm" className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white" disabled={editChildSaving}>
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="rounded-full h-8 text-xs" onClick={cancelEditChild} disabled={editChildSaving}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <span className="font-medium text-foreground">{c.first_name}</span>
                      <span className="text-foreground-secondary shrink-0">{formatDate(c.date_of_birth)}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditChild(c)}
                          className="p-1.5 rounded-full text-foreground-secondary hover:bg-muted hover:text-foreground"
                          aria-label="Edit child"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteChild(c.id, c.first_name)}
                          disabled={deletingChildId === c.id}
                          className="p-1.5 rounded-full text-foreground-secondary hover:bg-muted hover:text-destructive"
                          aria-label="Remove child"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        open={openCaseDetails}
        onToggle={() => setOpenCaseDetails((o) => !o)}
        title="Case Details"
      >
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium text-foreground-secondary">Case number</label>
            <p className="text-sm text-foreground mt-0.5">—</p>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-secondary">Jurisdiction</label>
            <p className="text-sm text-foreground mt-0.5">—</p>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-secondary">Custody split</label>
            <p className="text-sm text-foreground mt-0.5">{custodySplit}% / {100 - custodySplit}%</p>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-secondary">Co-parent status</label>
            <p className="text-sm text-foreground mt-0.5">—</p>
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        open={openCourtOrders}
        onToggle={() => setOpenCourtOrders((o) => !o)}
        title="Court Orders"
      >
        <div className="space-y-4">
          <Button
            size="sm"
            className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
            onClick={() => setShowAddCourtOrder((s) => !s)}
          >
            Add Court Order
          </Button>
          {courtOrders.length === 0 && !showAddCourtOrder && (
            <p className="text-sm text-foreground-secondary">No court orders added yet.</p>
          )}
          {courtOrders.length > 0 && (
            <ul className="space-y-2">
              {courtOrders.map((order) => {
                const id = String(order.id ?? order);
                const typeLabel = COURT_ORDER_TYPES.find((t) => t.value === order.document_type)?.label ?? (order.document_type as string) ?? "Court Order";
                const title = (order.title as string) ?? typeLabel;
                const isExpanded = expandedOrderId === id;
                return (
                  <li key={id} className="rounded-card border border-border bg-background overflow-hidden">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => setExpandedOrderId(isExpanded ? null : id)}
                    >
                      <span className="font-medium text-foreground text-sm">{title}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-foreground-secondary">{typeLabel}</span>
                        <span className="text-xs text-foreground-secondary">{formatDate(order.effective_date as string | null)}</span>
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-0 border-t border-border text-xs space-y-1.5">
                        {order.case_number && <p><span className="font-medium text-foreground-secondary">Case number:</span> {String(order.case_number)}</p>}
                        {order.jurisdiction && <p><span className="font-medium text-foreground-secondary">Jurisdiction:</span> {String(order.jurisdiction)}</p>}
                        {order.description && <p><span className="font-medium text-foreground-secondary">Description:</span> {String(order.description)}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {showAddCourtOrder && (
            <div className="max-w-lg rounded-card border border-border bg-background-secondary/30 p-4 space-y-4">
              <h4 className="font-heading text-sm font-semibold text-foreground">Add Court Order</h4>
              <div className="space-y-2">
                <div
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setAddFormDragActive(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setAddFormDragActive(false); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    setAddFormDragActive(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleAddFormFileSelect(f);
                  }}
                  className={cn(
                    "rounded-card border border-dashed flex flex-col items-center justify-center min-h-[80px] py-4 px-3 text-center transition-colors",
                    addFormDragActive ? "border-primary bg-primary/5" : "border-border bg-background-secondary/30"
                  )}
                >
                  <input
                    ref={addFormFileRef}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => handleAddFormFileSelect(e.target.files?.[0] ?? null)}
                  />
                  {!addFormFile ? (
                    <>
                      <p className="text-xs text-foreground-secondary">Drop file or click to browse</p>
                      <p className="text-[11px] text-foreground-secondary mt-1">{ACCEPT_LABEL}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2 h-7 text-xs rounded-full"
                        onClick={() => addFormFileRef.current?.click()}
                        disabled={addFormAnalyzing}
                      >
                        {addFormAnalyzing ? "Analyzing…" : "Choose file"}
                      </Button>
                    </>
                  ) : (
                    <div className="w-full flex items-center gap-2 p-2 rounded-card border border-border bg-background">
                      {addFormFile.type.startsWith("image/") ? <Image className="h-8 w-8 shrink-0 text-foreground-secondary" /> : <FileText className="h-8 w-8 shrink-0 text-foreground-secondary" />}
                      <div className="min-w-0 flex-1 text-left">
                        <p className="text-xs truncate">{addFormFile.name}</p>
                        <p className="text-[11px] text-foreground-secondary">{formatSize(addFormFile.size)}</p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => addFormFileRef.current?.click()}>Replace</Button>
                      <button type="button" className="p-1.5 rounded hover:bg-muted" onClick={() => handleAddFormFileSelect(null)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  )}
                </div>
                {addFormSuggested && <p className="text-xs text-muted-foreground">Fields auto-filled based on your file. Review before saving.</p>}
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Document type</Label>
                <select
                  value={addFormType}
                  onChange={(e) => setAddFormType(e.target.value)}
                  className={cn("flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                >
                  {COURT_ORDER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Court case number</Label>
                <input
                  type="text"
                  value={addFormCaseNumber}
                  onChange={(e) => setAddFormCaseNumber(e.target.value)}
                  placeholder="e.g. 2024-DR-12345"
                  className={cn("flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Jurisdiction</Label>
                <input
                  type="text"
                  value={addFormJurisdiction}
                  onChange={(e) => setAddFormJurisdiction(e.target.value)}
                  placeholder="e.g. Denver District Court"
                  className={cn("flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Effective date</Label>
                <input
                  type="date"
                  value={addFormEffectiveDate}
                  onChange={(e) => setAddFormEffectiveDate(e.target.value)}
                  className={cn("flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Brief description</Label>
                <textarea
                  value={addFormDescription}
                  onChange={(e) => setAddFormDescription(e.target.value)}
                  placeholder="Optional summary"
                  rows={3}
                  className={cn("flex w-full rounded-card border border-input bg-background px-2 py-1 text-xs resize-y", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white" onClick={() => { setShowAddCourtOrder(false); router.refresh(); }}>
                  Save Court Order
                </Button>
                <Button type="button" size="sm" variant="outline" className="rounded-full h-8 text-xs" onClick={() => setShowAddCourtOrder(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </CollapsibleCard>
    </div>
  );
}
