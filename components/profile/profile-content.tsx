"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ChevronRight, ChevronDown, FileText, Image, Trash2, Pencil, X, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const COURT_ORDER_TYPES = [
  { value: "parenting_plan", label: "Parenting Plan" },
  { value: "modification", label: "Modification" },
  { value: "custody_order", label: "Custody Order" },
  { value: "financial_order", label: "Financial Order" },
  { value: "restraining_order", label: "Restraining Order" },
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
  custody_type?: string;
  title?: string;
  effective_date?: string | null;
  court_case_number?: string | null;
  court_jurisdiction?: string | null;
  description?: string | null;
  schedule_description?: string | null;
  is_active?: boolean;
  file_path?: string | null;
  file_name?: string | null;
};

export type ProfileContentProps = {
  profile: { full_name?: string | null; email?: string | null } | null;
  userEmail: string | null;
  userId: string;
  children: { id: string; first_name: string; date_of_birth: string | null }[];
  custodySplit: number;
  courtOrders: CourtOrderRow[];
};

export function ProfileContent({
  profile,
  userEmail,
  userId,
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
  const [selectedCourtOrder, setSelectedCourtOrder] = useState<CourtOrderRow | null>(null);
  const [courtOrderDetailOpen, setCourtOrderDetailOpen] = useState(false);
  const [openDetailInEditMode, setOpenDetailInEditMode] = useState(false);
  const [detailEditMode, setDetailEditMode] = useState(false);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailCaseNumber, setDetailCaseNumber] = useState("");
  const [detailType, setDetailType] = useState("");
  const [detailJurisdiction, setDetailJurisdiction] = useState("");
  const [detailEffectiveDate, setDetailEffectiveDate] = useState("");
  const [detailStatus, setDetailStatus] = useState("active");
  const [detailDescription, setDetailDescription] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailSaveError, setDetailSaveError] = useState<string | null>(null);
  const [detailHistory, setDetailHistory] = useState<{ id: string; field_changed: string; old_value: string | null; new_value: string | null; changed_by_name: string | null; created_at: string }[]>([]);
  const [detailHistoryOpen, setDetailHistoryOpen] = useState(false);
  const [detailLoadingHistory, setDetailLoadingHistory] = useState(false);
  const [detailAttachFile, setDetailAttachFile] = useState<File | null>(null);
  const [detailAttachSaving, setDetailAttachSaving] = useState(false);
  const detailAttachFileRef = useRef<HTMLInputElement>(null);
  const [deleteCourtOrderConfirm, setDeleteCourtOrderConfirm] = useState<string | null>(null);
  const [deletingCourtOrderId, setDeletingCourtOrderId] = useState<string | null>(null);
  const [showAddCourtOrder, setShowAddCourtOrder] = useState(false);
  const [addFormFile, setAddFormFile] = useState<File | null>(null);
  const [addFormDragActive, setAddFormDragActive] = useState(false);
  const [addFormTitle, setAddFormTitle] = useState("");
  const [addFormType, setAddFormType] = useState<string>("parenting_plan");
  const [addFormCaseNumber, setAddFormCaseNumber] = useState("");
  const [addFormJurisdiction, setAddFormJurisdiction] = useState("");
  const [addFormEffectiveDate, setAddFormEffectiveDate] = useState("");
  const [addFormStatus, setAddFormStatus] = useState<string>("active");
  const [addFormDescription, setAddFormDescription] = useState("");
  const [addFormAnalyzing, setAddFormAnalyzing] = useState(false);
  const [addFormSuggested, setAddFormSuggested] = useState(false);
  const [addFormSaving, setAddFormSaving] = useState(false);
  const addFormFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (courtOrderDetailOpen && selectedCourtOrder) {
      const o = selectedCourtOrder;
      const docType = (o.custody_type ?? o.document_type) as string | undefined;
      setDetailTitle((o.title as string) ?? "");
      setDetailCaseNumber((o.court_case_number as string) ?? "");
      setDetailType(docType ?? "parenting_plan");
      setDetailJurisdiction((o.court_jurisdiction as string) ?? "");
      setDetailEffectiveDate((o.effective_date as string)?.slice(0, 10) ?? "");
      setDetailStatus((o.is_active as boolean) === true ? "active" : "superseded");
      setDetailDescription((o.schedule_description ?? o.description) as string ?? "");
      setDetailEditMode(openDetailInEditMode);
      setDetailSaveError(null);
      setDetailAttachFile(null);
    }
  }, [courtOrderDetailOpen, selectedCourtOrder, openDetailInEditMode]);

  useEffect(() => {
    const orderId = selectedCourtOrder?.id;
    if (!courtOrderDetailOpen || !orderId) return;
    let cancelled = false;
    async function load() {
      setDetailLoadingHistory(true);
      try {
        const res = await fetch(`/api/profile/court-orders/${orderId}/history`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setDetailHistory(data);
        else if (!cancelled) setDetailHistory([]);
      } catch {
        if (!cancelled) setDetailHistory([]);
      } finally {
        if (!cancelled) setDetailLoadingHistory(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [courtOrderDetailOpen, selectedCourtOrder?.id]);

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
  const [deleteChildConfirm, setDeleteChildConfirm] = useState<{ id: string; firstName: string } | null>(null);

  async function handleAddFormFileSelect(file: File | null) {
    if (!file) {
      setAddFormFile(null);
      setAddFormSuggested(false);
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
    if (!allowed.some((t) => file.type === t || file.type.startsWith("image/"))) return;
    setAddFormFile(file);
    setAddFormTitle(file.name.replace(/\.[^/.]+$/, "") || "");
    setAddFormAnalyzing(true);
    setAddFormSuggested(false);

    // Send file to AI for classification
    const formData = new FormData();
    formData.append("file", file);

    try {
      console.log("[court-order] Sending file to classify:", file.name);
      const res = await fetch("/api/inbox/classify", {
        method: "POST",
        body: formData,
      });
      console.log("[court-order] Classify response status:", res.status);
      if (res.ok) {
        const data = await res.json();
        console.log("[court-order] Classify result:", data);
        if (data.court_case_number) setAddFormCaseNumber(data.court_case_number);
        if (data.jurisdiction) setAddFormJurisdiction(data.jurisdiction);
        if (data.ai_description) setAddFormDescription(data.ai_description);
        setAddFormTitle(typeof data.ai_title === "string" && data.ai_title.trim() ? data.ai_title.trim() : file.name.replace(/\.[^/.]+$/, "") || "");
        if (data.ai_category) {
          // Map AI category to document type if possible
          const typeMap: Record<string, string> = {
            court_order: "parenting_plan",
            custody: "custody_order",
            legal: "modification",
          };
          setAddFormType(typeMap[data.ai_category] || data.ai_category);
        }
        if (data.ai_date) setAddFormEffectiveDate(String(data.ai_date).slice(0, 10));
        setAddFormSuggested(true);
      } else {
        const err = await res.text();
        console.error("[court-order] Classify failed:", err);
      }
    } catch (e) {
      console.error("[court-order] Classify error:", e);
    } finally {
      setAddFormAnalyzing(false);
    }
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

  function openDeleteChildConfirm(childId: string, firstName: string) {
    setDeleteChildConfirm({ id: childId, firstName });
  }

  function closeDeleteChildConfirm() {
    setDeleteChildConfirm(null);
  }

  async function confirmDeleteChild() {
    if (!deleteChildConfirm) return;
    const { id: childId } = deleteChildConfirm;
    setDeletingChildId(childId);
    try {
      const res = await fetch(`/api/children/${childId}/delete`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert((data as { error?: string }).error ?? "Failed to remove child");
        return;
      }
      closeDeleteChildConfirm();
      router.refresh();
    } finally {
      setDeletingChildId(null);
    }
  }

  async function confirmDeleteCourtOrder() {
    const id = deleteCourtOrderConfirm;
    if (!id) return;
    setDeletingCourtOrderId(id);
    try {
      const res = await fetch(`/api/profile/court-orders/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert((data as { error?: string }).error ?? "Failed to delete court order");
        return;
      }
      setDeleteCourtOrderConfirm(null);
      setCourtOrderDetailOpen(false);
      setSelectedCourtOrder(null);
      router.refresh();
    } finally {
      setDeletingCourtOrderId(null);
    }
  }

  const allSectionsOpen = openYourInfo && openChildren && openCaseDetails && openCourtOrders;

  return (
    <div className="space-y-6">
      <p className="text-xs md:text-sm text-foreground-secondary mb-4">Your family, case details, and parenting plan.</p>
      <div className="flex justify-start">
        <button
          type="button"
          className="text-xs text-foreground-secondary hover:text-foreground underline cursor-pointer bg-transparent border-none p-0"
          onClick={() => {
            if (allSectionsOpen) {
              setOpenYourInfo(false);
              setOpenCourtOrders(false);
              setOpenChildren(false);
              setOpenCaseDetails(false);
            } else {
              setOpenYourInfo(true);
              setOpenCourtOrders(true);
              setOpenChildren(true);
              setOpenCaseDetails(true);
            }
          }}
        >
          {allSectionsOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
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
        open={openCourtOrders}
        onToggle={() => setOpenCourtOrders((o) => !o)}
        title="Court Orders"
      >
        <div className="space-y-4">
          <Button
            size="sm"
            className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
            onClick={() => {
              setAddFormFile(null);
              setAddFormTitle("");
              setAddFormType("parenting_plan");
              setAddFormCaseNumber("");
              setAddFormJurisdiction("");
              setAddFormEffectiveDate("");
              setAddFormDescription("");
              setAddFormSuggested(false);
              setAddFormAnalyzing(false);
              setShowAddCourtOrder(true);
            }}
          >
            Add Court Order
          </Button>

          <div className="max-w-lg">
            {courtOrders.filter((o) => !(o as { deleted_at?: string | null }).deleted_at).length === 0 ? (
              <p className="text-sm text-foreground-secondary py-2">No court orders uploaded yet.</p>
            ) : (
              <div className="rounded-card border border-border bg-background overflow-hidden">
                <div className="grid grid-cols-5 gap-2 text-xs font-medium text-foreground-secondary border-b border-border py-1.5 px-2">
                  <span>Case #</span>
                  <span className="text-left">Title</span>
                  <span className="text-left">Type</span>
                  <span className="text-left">Date</span>
                  <span>Actions</span>
                </div>
                <ul>
                  {courtOrders
                    .filter((o) => !(o as { deleted_at?: string | null }).deleted_at)
                    .map((order) => {
                      const id = String(order.id ?? order);
                      const docType = (order.custody_type ?? order.document_type) as string | undefined;
                      const typeLabel = COURT_ORDER_TYPES.find((t) => t.value === docType)?.label ?? docType ?? "Court Order";
                      const caseNum = (order.court_case_number as string) ?? "—";
                      return (
                        <li key={id} className="border-b border-border last:border-b-0">
                          <div
                            className="grid grid-cols-5 gap-2 items-center py-2 px-2 min-w-0 cursor-pointer hover:bg-muted/50 transition-colors"
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setOpenDetailInEditMode(false);
                              setSelectedCourtOrder(order);
                              setCourtOrderDetailOpen(true);
                            }}
                            onKeyDown={(e) => e.key === "Enter" && (setOpenDetailInEditMode(false), setSelectedCourtOrder(order), setCourtOrderDetailOpen(true))}
                          >
                            <span className="min-w-0 truncate text-xs font-medium text-foreground">{caseNum}</span>
                            <span className="min-w-0 truncate text-xs text-foreground">{(order.title as string) ?? "—"}</span>
                            <span className="min-w-0 truncate rounded-full bg-muted px-2 py-0.5 text-xs text-foreground-secondary">{typeLabel}</span>
                            <span className="min-w-0 truncate text-xs text-foreground-secondary">{formatDate(order.effective_date as string | null)}</span>
                            <div className="flex items-center justify-end gap-0.5 min-w-0" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="p-1 rounded text-foreground-secondary hover:text-foreground"
                                aria-label="Edit"
                                onClick={() => {
                                  setOpenDetailInEditMode(true);
                                  setSelectedCourtOrder(order);
                                  setCourtOrderDetailOpen(true);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {(order.file_path as string) ? (
                                <button
                                  type="button"
                                  className="p-1 rounded text-foreground-secondary hover:text-foreground"
                                  aria-label="Download"
                                  onClick={async () => {
                                    const res = await fetch(`/api/profile/court-orders/${order.id}/download`).catch(() => null);
                                    if (res?.ok) {
                                      const data = await res.json().catch(() => ({}));
                                      if (data?.url) window.open(data.url, "_blank");
                                    }
                                  }}
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="p-1 rounded text-foreground-secondary hover:text-destructive"
                                aria-label="Delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteCourtOrderConfirm(order.id);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </div>
            )}
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
            <div className="rounded-card border border-border bg-background overflow-hidden">
              <p className="text-sm text-foreground-secondary py-4 px-3">Upload a court order to auto-fill, or add manually.</p>
            </div>
          ) : children.length > 0 ? (
            <div className="max-w-lg rounded-card border border-border bg-background overflow-hidden">
              <div className="flex items-center py-2 px-2 border-b border-border text-xs font-medium text-foreground-secondary">
                <span className="w-32 shrink-0">Name</span>
                <span className="w-36 shrink-0">Date of birth</span>
                <div className="flex-1" />
              </div>
              <ul>
                {children.map((c) => (
                  <li key={c.id} className="border-b border-border last:border-b-0">
                    {editingChildId === c.id ? (
                      <form
                        onSubmit={(e) => handleEditChildSave(e, c.id)}
                        className="flex flex-wrap items-end gap-2 py-2 px-2 min-w-0"
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
                      <div className="flex items-center py-2 px-2">
                        <span className="w-32 shrink-0 text-sm font-medium truncate" title={c.first_name}>{c.first_name}</span>
                        <span className="w-36 shrink-0 text-xs text-foreground-secondary">{formatDate(c.date_of_birth)}</span>
                        <div className="flex-1 min-w-0" />
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEditChild(c)}
                            className="p-1 rounded text-gray-400 hover:text-gray-600"
                            aria-label="Edit child"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteChildConfirm(c.id, c.first_name)}
                            disabled={deletingChildId === c.id}
                            className="p-1 rounded text-gray-400 hover:text-gray-600"
                            aria-label="Remove child"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
            <p className="text-sm text-foreground mt-0.5">
              {courtOrders.filter((o) => !(o as { deleted_at?: string | null }).deleted_at).length > 0
                ? (courtOrders.filter((o) => !(o as { deleted_at?: string | null }).deleted_at)[0]?.court_case_number ?? "—")
                : "Upload a court order to auto-fill"}
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-secondary">Jurisdiction</label>
            <p className="text-sm text-foreground mt-0.5">
              {courtOrders.filter((o) => !(o as { deleted_at?: string | null }).deleted_at).length > 0
                ? (courtOrders.filter((o) => !(o as { deleted_at?: string | null }).deleted_at)[0]?.court_jurisdiction ?? "—")
                : "Upload a court order to auto-fill"}
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-secondary">Custody split</label>
            <p className="text-sm text-foreground mt-0.5">{custodySplit}% / {100 - custodySplit}%</p>
          </div>
        </div>
      </CollapsibleCard>

      {courtOrderDetailOpen && selectedCourtOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="court-order-detail-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setCourtOrderDetailOpen(false);
              setSelectedCourtOrder(null);
            }
          }}
        >
          <div
            className="bg-background border border-border rounded-card shadow-card max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {(() => {
              const o = selectedCourtOrder;
              const docType = (o.custody_type ?? o.document_type) as string | undefined;
              const typeLabel = COURT_ORDER_TYPES.find((t) => t.value === docType)?.label ?? docType ?? "Court Order";
              const caseNum = (o.court_case_number as string) ?? "—";
              const statusLabel = (o.is_active as boolean) === true ? "Active" : "Superseded";
              const filePath = (o.file_path as string) ?? null;
              const fileDisplayName = filePath ? filePath.split("/").pop() ?? null : null;
              const hasFile = !!filePath;

              function historyFieldLabel(field: string): string {
                const m: Record<string, string> = {
                  court_case_number: "Case number",
                  custody_type: "Document type",
                  court_jurisdiction: "Jurisdiction",
                  effective_date: "Effective date",
                  is_active: "Status",
                  schedule_description: "Description",
                  title: "Title",
                };
                return m[field] ?? field;
              }

              function formatHistoryTimestamp(iso: string) {
                return new Date(iso).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });
              }

              return (
                <>
                  <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
                    <h2 id="court-order-detail-title" className="font-heading text-lg font-semibold text-foreground">
                      {caseNum} — {typeLabel}
                    </h2>
                    <button
                      type="button"
                      className="p-1.5 rounded-full text-foreground-secondary hover:bg-muted hover:text-foreground"
                      aria-label="Close"
                      onClick={() => { setCourtOrderDetailOpen(false); setSelectedCourtOrder(null); }}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div
                    className="p-4 overflow-y-auto space-y-4 flex-1"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div>
                      <p className="text-xs text-foreground-secondary mb-0.5">File</p>
                      {hasFile ? (
                        <button
                          type="button"
                          className="text-sm text-foreground underline cursor-pointer hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring rounded"
                          onClick={async () => {
                            const res = await fetch(`/api/profile/court-orders/${o.id}/download`).catch(() => null);
                            if (res?.ok) {
                              const data = await res.json().catch(() => ({}));
                              if (data?.url) window.open(data.url, "_blank");
                            }
                          }}
                        >
                          {fileDisplayName ?? "View / download"}
                        </button>
                      ) : (
                        <>
                          <p className="text-sm text-foreground">No file attached</p>
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              ref={detailAttachFileRef}
                              type="file"
                              accept=".pdf,image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) setDetailAttachFile(f);
                              }}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-full h-8 text-xs"
                              disabled={detailAttachSaving}
                              onClick={() => detailAttachFileRef.current?.click()}
                            >
                              {detailAttachSaving ? "Uploading…" : detailAttachFile ? detailAttachFile.name : "Choose file"}
                            </Button>
                            {detailAttachFile && (
                              <Button
                                type="button"
                                size="sm"
                                className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                                disabled={detailAttachSaving}
                                onClick={async () => {
                                  if (!detailAttachFile || !o.id) return;
                                  setDetailAttachSaving(true);
                                  try {
                                    const fd = new FormData();
                                    fd.append("file", detailAttachFile);
                                    const res = await fetch(`/api/profile/court-orders/${o.id}/attach-file`, { method: "POST", body: fd });
                                    const data = await res.json().catch(() => ({}));
                                    if (!res.ok) {
                                      window.alert((data as { error?: string }).error ?? "Failed to attach file");
                                      return;
                                    }
                                    setSelectedCourtOrder({ ...o, file_path: (data as { file_path?: string }).file_path ?? null });
                                    setDetailAttachFile(null);
                                    router.refresh();
                                  } finally {
                                    setDetailAttachSaving(false);
                                  }
                                }}
                              >
                                Attach
                              </Button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                    {!detailEditMode ? (
                      <>
                        <div>
                          <p className="text-xs text-foreground-secondary mb-0.5">Document title</p>
                          <p className="text-sm text-foreground">{(o.title as string) || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-foreground-secondary mb-0.5">Case number</p>
                          <p className="text-sm text-foreground">{caseNum}</p>
                        </div>
                        <div>
                          <p className="text-xs text-foreground-secondary mb-0.5">Document type</p>
                          <p className="text-sm text-foreground">{typeLabel}</p>
                        </div>
                        <div>
                          <p className="text-xs text-foreground-secondary mb-0.5">Jurisdiction</p>
                          <p className="text-sm text-foreground">{(o.court_jurisdiction as string) || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-foreground-secondary mb-0.5">Effective date</p>
                          <p className="text-sm text-foreground">{formatDate(o.effective_date as string | null)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-foreground-secondary mb-0.5">Status</p>
                          <p className="text-sm text-foreground">{statusLabel}</p>
                        </div>
                        <div>
                          <p className="text-xs text-foreground-secondary mb-0.5">Description</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap">{(o.schedule_description ?? o.description) as string || "—"}</p>
                        </div>
                      </>
                    ) : (
                      <>
                        {detailSaveError && <p className="text-xs text-alert" role="alert">{detailSaveError}</p>}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Document title</Label>
                          <input
                            type="text"
                            value={detailTitle}
                            onChange={(e) => setDetailTitle(e.target.value)}
                            placeholder="e.g. Parenting Plan, Custody Order"
                            className={cn("flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Case number</Label>
                          <input
                            type="text"
                            value={detailCaseNumber}
                            onChange={(e) => setDetailCaseNumber(e.target.value)}
                            placeholder="e.g. 2024-DR-12345"
                            className={cn("flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Document type</Label>
                          <select
                            value={detailType}
                            onChange={(e) => setDetailType(e.target.value)}
                            className={cn("flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                          >
                            {COURT_ORDER_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Jurisdiction</Label>
                          <input
                            type="text"
                            value={detailJurisdiction}
                            onChange={(e) => setDetailJurisdiction(e.target.value)}
                            placeholder="e.g. Denver District Court"
                            className={cn("flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Effective date</Label>
                          <input
                            type="date"
                            value={detailEffectiveDate}
                            onChange={(e) => setDetailEffectiveDate(e.target.value)}
                            className={cn("flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Status</Label>
                          <select
                            value={detailStatus}
                            onChange={(e) => setDetailStatus(e.target.value)}
                            className={cn("flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                          >
                            <option value="active">Active</option>
                            <option value="superseded">Superseded</option>
                            <option value="pending">Pending (for orders not yet in effect)</option>
                            <option value="expired">Expired</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Brief description</Label>
                          <textarea
                            value={detailDescription}
                            onChange={(e) => setDetailDescription(e.target.value)}
                            placeholder="Optional summary"
                            rows={3}
                            className={cn("flex w-full rounded-card border border-input bg-background px-2 py-1 text-xs resize-y", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                          />
                        </div>
                      </>
                    )}

                    <section className="space-y-2 border-t border-border pt-4 mt-4">
                      <button
                        type="button"
                        onClick={() => setDetailHistoryOpen((prev) => !prev)}
                        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-foreground-secondary/80 hover:text-foreground"
                      >
                        <span>Edit history</span>
                        <span className="text-[10px]">{detailHistoryOpen ? "▾" : "▸"}</span>
                      </button>
                      {detailHistoryOpen && (
                        <div className="rounded-card border border-border/60 bg-background-secondary/40 px-3 py-2">
                          {detailLoadingHistory ? (
                            <p className="text-xs text-foreground-secondary">Loading history…</p>
                          ) : detailHistory.length === 0 ? (
                            <p className="text-xs text-foreground-secondary">No changes recorded yet.</p>
                          ) : (
                            <ul className="space-y-1 text-xs text-foreground-secondary">
                              {detailHistory.map((h) => (
                                <li key={h.id}>
                                  <span>{historyFieldLabel(h.field_changed)} changed to {h.new_value ?? "—"}</span>
                                  <span className="ml-1">
                                    by {h.changed_by_name ?? "Unknown"} — {formatHistoryTimestamp(h.created_at)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </section>
                  </div>

                  {detailEditMode && (
                    <div className="p-4 border-t border-border flex gap-2 justify-between items-center shrink-0">
                      <button
                        type="button"
                        className="text-xs text-destructive hover:underline cursor-pointer bg-transparent border-none p-0"
                        onClick={() => setDeleteCourtOrderConfirm(selectedCourtOrder?.id ?? null)}
                      >
                        Delete
                      </button>
                      <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full h-8 text-xs"
                        onClick={() => {
                          setDetailEditMode(false);
                          setDetailSaveError(null);
                          setCourtOrderDetailOpen(false);
                          setSelectedCourtOrder(null);
                        }}
                        disabled={detailSaving}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                        disabled={detailSaving}
                        onClick={async () => {
                          if (!selectedCourtOrder?.id) return;
                          const orig = selectedCourtOrder;
                          const origTitle = (orig.title as string) ?? "";
                          const origCase = (orig.court_case_number as string) ?? "";
                          const origType = (orig.custody_type ?? orig.document_type) as string ?? "parenting_plan";
                          const origJuris = (orig.court_jurisdiction as string) ?? "";
                          const origDate = (orig.effective_date as string)?.slice(0, 10) ?? "";
                          const origActive = (orig.is_active as boolean) === true;
                          const origDesc = (orig.schedule_description ?? orig.description) as string ?? "";
                          const historyEntries: { field_changed: string; old_value: string | null; new_value: string }[] = [];
                          if (detailTitle.trim() !== origTitle) historyEntries.push({ field_changed: "title", old_value: origTitle || null, new_value: detailTitle.trim() });
                          if (detailCaseNumber.trim() !== origCase) historyEntries.push({ field_changed: "court_case_number", old_value: origCase || null, new_value: detailCaseNumber.trim() });
                          if (detailType !== origType) historyEntries.push({ field_changed: "custody_type", old_value: COURT_ORDER_TYPES.find((t) => t.value === origType)?.label ?? origType, new_value: COURT_ORDER_TYPES.find((t) => t.value === detailType)?.label ?? detailType });
                          if (detailJurisdiction.trim() !== origJuris) historyEntries.push({ field_changed: "court_jurisdiction", old_value: origJuris || null, new_value: detailJurisdiction.trim() });
                          if (detailEffectiveDate !== origDate) historyEntries.push({ field_changed: "effective_date", old_value: origDate || null, new_value: detailEffectiveDate || "" });
                          if ((detailStatus === "active") !== origActive) historyEntries.push({ field_changed: "is_active", old_value: origActive ? "Active" : "Superseded", new_value: detailStatus === "active" ? "Active" : "Superseded" });
                          if (detailDescription.trim() !== origDesc) historyEntries.push({ field_changed: "schedule_description", old_value: origDesc || null, new_value: detailDescription.trim() });
                          setDetailSaving(true);
                          setDetailSaveError(null);
                          try {
                            const res = await fetch(`/api/profile/court-orders/${selectedCourtOrder.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                title: detailTitle.trim() || null,
                                court_case_number: detailCaseNumber.trim() || null,
                                custody_type: detailType,
                                court_jurisdiction: detailJurisdiction.trim() || null,
                                effective_date: detailEffectiveDate || null,
                                schedule_description: detailDescription.trim() || null,
                                is_active: detailStatus === "active",
                                ...(historyEntries.length > 0 ? { history: historyEntries } : {}),
                              }),
                            });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error((data as { error?: string }).error ?? "Save failed");
                            router.refresh();
                            setDetailEditMode(false);
                            const histRes = await fetch(`/api/profile/court-orders/${selectedCourtOrder.id}/history`);
                            if (histRes.ok) {
                              const histData = await histRes.json();
                              if (Array.isArray(histData)) setDetailHistory(histData);
                            }
                            setCourtOrderDetailOpen(false);
                            setSelectedCourtOrder(null);
                          } catch (e) {
                            setDetailSaveError(e instanceof Error ? e.message : "Save failed");
                          } finally {
                            setDetailSaving(false);
                          }
                        }}
                      >
                        {detailSaving ? "Saving…" : "Save"}
                      </Button>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {showAddCourtOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-court-order-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setAddFormFile(null);
              setAddFormTitle("");
              setAddFormType("parenting_plan");
              setAddFormCaseNumber("");
              setAddFormJurisdiction("");
              setAddFormEffectiveDate("");
              setAddFormDescription("");
              setAddFormSuggested(false);
              setAddFormAnalyzing(false);
              setShowAddCourtOrder(false);
            }
          }}
        >
          <div
            className="bg-background border border-border rounded-card shadow-card max-w-md w-full mx-4 p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 id="add-court-order-title" className="font-heading text-lg font-semibold text-foreground">
                Add Court Order
              </h2>
              <button
                type="button"
                className="p-1.5 rounded-full text-foreground-secondary hover:bg-muted hover:text-foreground"
                aria-label="Close"
                onClick={() => {
                  setAddFormFile(null);
                  setAddFormTitle("");
                  setAddFormType("parenting_plan");
                  setAddFormCaseNumber("");
                  setAddFormJurisdiction("");
                  setAddFormEffectiveDate("");
                  setAddFormDescription("");
                  setAddFormSuggested(false);
                  setAddFormAnalyzing(false);
                  setShowAddCourtOrder(false);
                }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
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
                {addFormAnalyzing && (
                  <div className="flex items-center gap-2 text-xs text-foreground-secondary py-2">
                    <svg className="animate-spin h-4 w-4 text-[#7B9E87]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Reading your document...
                  </div>
                )}
                {!addFormAnalyzing && addFormSuggested && <p className="text-xs text-muted-foreground">Fields auto-filled based on your file. Review before saving.</p>}
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Document title</Label>
                <input
                  type="text"
                  value={addFormTitle}
                  onChange={(e) => setAddFormTitle(e.target.value)}
                  placeholder="e.g. Parenting Plan, Custody Order"
                  className={cn("flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                />
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
                <Label className="text-xs font-medium">Status</Label>
                <select
                  value={addFormStatus}
                  onChange={(e) => setAddFormStatus(e.target.value)}
                  className={cn("flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                >
                  <option value="active">Active</option>
                  <option value="superseded">Superseded</option>
                  <option value="pending">Pending (for orders not yet in effect)</option>
                  <option value="expired">Expired</option>
                </select>
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
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                  disabled={addFormSaving}
                  onClick={async () => {
                    setAddFormSaving(true);
                    try {
                      const titleValue = addFormTitle.trim() || (addFormFile ? addFormFile.name.replace(/\.[^/.]+$/, "") : null) || null;
                      let res: Response;
                      if (addFormFile) {
                        const formData = new FormData();
                        formData.append("file", addFormFile);
                        formData.append("title", titleValue ?? "");
                        formData.append("document_type", addFormType);
                        formData.append("case_number", addFormCaseNumber || "");
                        formData.append("jurisdiction", addFormJurisdiction || "");
                        formData.append("effective_date", addFormEffectiveDate || "");
                        formData.append("description", addFormDescription || "");
                        formData.append("status", addFormStatus);
                        formData.append("userId", userId);
                        res = await fetch("/api/profile/court-orders", { method: "POST", body: formData });
                      } else {
                        res = await fetch("/api/profile/court-orders", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            title: titleValue,
                            document_type: addFormType,
                            case_number: addFormCaseNumber || null,
                            jurisdiction: addFormJurisdiction || null,
                            effective_date: addFormEffectiveDate || null,
                            description: addFormDescription || null,
                            status: addFormStatus,
                            userId: userId,
                          }),
                        });
                      }
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        window.alert((err as { error?: string }).error ?? "Failed to save court order");
                        return;
                      }
                      setShowAddCourtOrder(false);
                      router.refresh();
                    } finally {
                      setAddFormSaving(false);
                    }
                  }}
                >
                  {addFormSaving ? "Saving…" : "Save Court Order"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full h-8 text-xs"
                  onClick={() => {
                    setAddFormFile(null);
                    setAddFormTitle("");
                    setAddFormType("parenting_plan");
                    setAddFormCaseNumber("");
                    setAddFormJurisdiction("");
                    setAddFormEffectiveDate("");
                    setAddFormDescription("");
                    setAddFormSuggested(false);
                    setAddFormAnalyzing(false);
                    setShowAddCourtOrder(false);
                  }}
                  disabled={addFormSaving}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteChildConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-child-title"
          onClick={(e) => e.target === e.currentTarget && closeDeleteChildConfirm()}
        >
          <div className="bg-background border border-border rounded-card shadow-card max-w-sm w-full mx-4 p-4">
            <h3 id="delete-child-title" className="font-heading text-base font-semibold text-foreground mb-2">
              Remove child?
            </h3>
            <p className="text-sm text-foreground-secondary mb-4">
              Remove {deleteChildConfirm.firstName} from your family? This can be undone by contacting support.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="rounded-full" onClick={closeDeleteChildConfirm}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="rounded-full bg-alert hover:bg-alert/90"
                onClick={confirmDeleteChild}
                disabled={deletingChildId === deleteChildConfirm.id}
              >
                {deletingChildId === deleteChildConfirm.id ? "Removing…" : "Remove"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteCourtOrderConfirm !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-court-order-title"
          onClick={(e) => e.target === e.currentTarget && setDeleteCourtOrderConfirm(null)}
        >
          <div className="bg-background border border-border rounded-card shadow-card max-w-sm w-full mx-4 p-4">
            <h3 id="delete-court-order-title" className="font-heading text-base font-semibold text-foreground mb-2">
              Delete court order?
            </h3>
            <p className="text-sm text-foreground-secondary mb-4">
              Are you sure you want to delete this court order?
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setDeleteCourtOrderConfirm(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="rounded-full bg-alert hover:bg-alert/90"
                onClick={confirmDeleteCourtOrder}
                disabled={deletingCourtOrderId === deleteCourtOrderConfirm}
              >
                {deletingCourtOrderId === deleteCourtOrderConfirm ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
