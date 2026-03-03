"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColumnFilterPopover } from "@/components/documents/column-filter-popover";
import { ChildMultiSelect, type ChildOption } from "@/components/documents/child-multi-select";
import { cn } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";
import { Filter, Pencil, Trash2, Lock } from "lucide-react";

export type ContactRow = {
  id: string;
  name: string;
  role: string | null;
  organization: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  visibility: string;
  is_emergency?: boolean;
  child_ids: string[];
  child_names: string[];
};

interface ContactListProps {
  contacts: ContactRow[];
  children: ChildOption[];
}

function csvEscape(value: string): string {
  const s = String(value ?? "").replace(/"/g, '""');
  return /[",\r\n]/.test(s) ? `"${s}"` : s;
}

function getRoleBadgeClasses(role: string | null): string {
  const r = (role ?? "").toLowerCase();
  if (!r) return "bg-gray-100 text-gray-700";
  if (r.includes("doctor") || r.includes("dentist") || r.includes("medical")) {
    // Medical: blue
    return "bg-blue-50 text-blue-700";
  }
  if (r.includes("therapist") || r.includes("counselor") || r.includes("psychologist")) {
    // Therapist: lavender
    return "bg-purple-50 text-purple-700";
  }
  if (r.includes("teacher") || r.includes("school") || r.includes("principal")) {
    // School: yellow
    return "bg-amber-50 text-amber-800";
  }
  if (r.includes("coach")) {
    // Coach: teal
    return "bg-teal-50 text-teal-700";
  }
  if (r.includes("attorney") || r.includes("lawyer") || r.includes("mediator") || r.includes("legal")) {
    // Legal: soft red
    return "bg-rose-50 text-rose-700";
  }
  // Other: gray
  return "bg-gray-100 text-gray-700";
}

export function ContactList({ contacts, children }: ContactListProps) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState("");
  const [filterRoles, setFilterRoles] = useState<string[]>([]);
  const [filterChildren, setFilterChildren] = useState<string[]>([]);
  const [filterOrganizations, setFilterOrganizations] = useState<string[]>([]);
  const [roleFilterOpen, setRoleFilterOpen] = useState(false);
  const [childFilterOpen, setChildFilterOpen] = useState(false);
  const [orgFilterOpen, setOrgFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [modalContact, setModalContact] = useState<ContactRow | null>(null);
  const [modalMode, setModalMode] = useState<"view" | "edit">("view");
  const [modalChildIds, setModalChildIds] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const debouncedSearch = searchInput.trim().toLowerCase();

  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    contacts.forEach((c) => {
      if (c.role) set.add(c.role);
    });
    return Array.from(set).sort().map((r) => ({ value: r, label: r }));
  }, [contacts]);

  const organizationOptions = useMemo(() => {
    const set = new Set<string>();
    contacts.forEach((c) => {
      if (c.organization) set.add(c.organization);
    });
    return Array.from(set).sort().map((o) => ({ value: o, label: o }));
  }, [contacts]);

  const childOptions = useMemo(
    () => children.map((c) => ({ value: c.id, label: c.first_name })),
    [children]
  );

  const childAvatarMap = useMemo(
    () =>
      children.reduce(
        (acc, c) => {
          acc[c.id] = {
            name: c.first_name,
            profile_image: (c as any).profile_image as string | null | undefined,
          };
          return acc;
        },
        {} as Record<string, { name: string; profile_image: string | null | undefined }>
      ),
    [children]
  );

  const anyFilterActive =
    debouncedSearch.length > 0 ||
    filterRoles.length > 0 ||
    filterChildren.length > 0 ||
    filterOrganizations.length > 0;

  const filtered = useMemo(() => {
    let list = [...contacts];
    if (debouncedSearch) {
      const parts = debouncedSearch.split(/\s+/).filter(Boolean);
      list = list.filter((c) => {
        const text = [
          c.name ?? "",
          c.role ?? "",
          c.organization ?? "",
          c.phone ?? "",
          c.email ?? "",
          c.child_names.join(" "),
        ]
          .join(" ")
          .toLowerCase();
        return parts.every((p) => text.includes(p));
      });
    }
    if (filterRoles.length > 0) {
      list = list.filter((c) => c.role && filterRoles.includes(c.role));
    }
    if (filterChildren.length > 0) {
      list = list.filter((c) =>
        c.child_ids.some((id) => filterChildren.includes(id))
      );
    }
    if (filterOrganizations.length > 0) {
      list = list.filter(
        (c) => c.organization && filterOrganizations.includes(c.organization)
      );
    }
    return list;
  }, [contacts, debouncedSearch, filterRoles, filterChildren, filterOrganizations]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

  function handleExportCSV() {
    if (filtered.length === 0) return;
    const headers = [
      "Name",
      "Role",
      "Organization",
      "Phone",
      "Email",
      "Address",
      "Children",
      "Notes",
    ];
    const rows = filtered.map((c) => {
      const childrenLabel =
        c.child_names.length === 0 ? "" : c.child_names.join(", ");
      return [
        c.name ?? "",
        c.role ?? "",
        c.organization ?? "",
        c.phone ?? "",
        c.email ?? "",
        c.address ?? "",
        childrenLabel,
        c.notes ?? "",
      ]
        .map(csvEscape)
        .join(",");
    });
    const csv = [headers.map(csvEscape).join(","), ...rows].join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MyVow_Contacts_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearAllFilters() {
    setSearchInput("");
    setFilterRoles([]);
    setFilterChildren([]);
    setFilterOrganizations([]);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const allSelected =
        filtered.length > 0 && filtered.every((c) => prev.has(c.id));
      if (allSelected) return new Set();
      const next = new Set<string>();
      filtered.forEach((c) => next.add(c.id));
      return next;
    });
  }

  function handleExportSelected() {
    const selected = filtered.filter((c) => selectedIds.has(c.id));
    if (selected.length === 0) return;

    const headers = [
      "Name",
      "Role",
      "Organization",
      "Phone",
      "Email",
      "Address",
      "Children",
      "Notes",
    ];
    const rows = selected.map((c) => {
      const childrenLabel =
        c.child_names.length === 0 ? "" : c.child_names.join(", ");
      return [
        c.name ?? "",
        c.role ?? "",
        c.organization ?? "",
        c.phone ?? "",
        c.email ?? "",
        c.address ?? "",
        childrenLabel,
        c.notes ?? "",
      ]
        .map(csvEscape)
        .join(",");
    });
    const csv = [headers.map(csvEscape).join(","), ...rows].join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MyVow_Contacts_Selected_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setSelectedIds(new Set());
  }

  function openDetail(c: ContactRow) {
    setModalContact(c);
    setModalChildIds(c.child_ids ?? []);
    setModalMode("view");
  }

  function openEdit(c: ContactRow) {
    setModalContact(c);
    setModalChildIds(c.child_ids ?? []);
    setModalMode("edit");
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this contact?")) return;
    setDeletingId(id);
    try {
      const res = await fetch("/api/contacts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = (data as { error?: string }).error ?? "Failed to delete contact.";
        showErrorToast(message);
        return;
      }
      router.refresh();
      showSuccessToast("Contact deleted");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    if (!modalContact) return;
    setEditSaving(true);
    try {
      const form = e.target as HTMLFormElement;
      const formData = new FormData(form);
      const payload = {
        id: modalContact.id,
        name: String(formData.get("name") ?? "").trim(),
        role: (formData.get("role") as string) || null,
        organization: String(formData.get("organization") ?? "").trim() || null,
        phone: String(formData.get("phone") ?? "").trim() || null,
        email: String(formData.get("email") ?? "").trim() || null,
        address: String(formData.get("address") ?? "").trim() || null,
        notes: String(formData.get("notes") ?? "").trim() || null,
        visibility: (formData.get("visibility") as string) || "parents",
        child_ids: modalChildIds,
      };
      if (!payload.name) {
        showErrorToast("Name is required.");
        setEditSaving(false);
        return;
      }
      const res = await fetch("/api/contacts/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = (data as { message?: string }).message ?? "Could not save contact.";
        showErrorToast(message);
        setEditSaving(false);
        return;
      }
      setModalContact(null);
      setModalChildIds([]);
      setModalMode("view");
      router.refresh();
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="font-heading text-lg text-foreground">
          All contacts
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            placeholder="Search name, role, organization..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 w-full max-w-[280px] rounded-card border-border text-sm"
            aria-label="Search contacts"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 rounded-full text-xs shrink-0 text-foreground-secondary hover:text-foreground hover:bg-muted/60"
            onClick={handleExportCSV}
            disabled={filtered.length === 0}
          >
            Export
          </Button>
          {anyFilterActive && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-xs text-foreground-secondary hover:text-foreground hover:underline shrink-0"
            >
              Clear filters
            </button>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 py-2 px-3 rounded-card border border-border bg-background-secondary/60">
            <span className="text-xs text-foreground-secondary">
              {selectedIds.size} selected
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full h-8 text-xs text-foreground-secondary hover:text-foreground"
              onClick={handleExportSelected}
            >
              Export selected
            </Button>
          </div>
        )}

        {contacts.length === 0 ? (
          <div className="py-12 text-center rounded-card border border-dashed border-border bg-background-secondary/30">
            <p className="text-sm text-foreground-secondary mb-1">
              No contacts yet.
            </p>
            <p className="text-xs text-foreground-secondary">
              Add your first contact using the form on the left.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center rounded-card border border-dashed border-border bg-background-secondary/30">
            <p className="text-sm text-foreground-secondary mb-1">
              No contacts match your filters.
            </p>
            <p className="text-xs text-foreground-secondary">
              Adjust filters or clear them to see all contacts.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border bg-background">
            <table className="min-w-full table-fixed text-left text-xs md:text-sm">
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: "30%" }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 72 }} />
            </colgroup>
              <thead>
                <tr className="bg-[#E7EFE8]/80 text-foreground-secondary">
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all visible"
                      className="rounded border-border"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Role</span>
                      <ColumnFilterPopover
                        title="Role"
                        options={roleOptions}
                        selected={filterRoles}
                        onApply={setFilterRoles}
                        onClear={() => setFilterRoles([])}
                        open={roleFilterOpen}
                        onOpenChange={setRoleFilterOpen}
                        active={filterRoles.length > 0}
                        icon={Filter}
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Organization</span>
                      <ColumnFilterPopover
                        title="Organization"
                        options={organizationOptions}
                        selected={filterOrganizations}
                        onApply={setFilterOrganizations}
                        onClear={() => setFilterOrganizations([])}
                        open={orgFilterOpen}
                        onOpenChange={setOrgFilterOpen}
                        active={filterOrganizations.length > 0}
                        icon={Filter}
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Child</span>
                      <ColumnFilterPopover
                        title="Child"
                        options={childOptions}
                        selected={filterChildren}
                        onApply={setFilterChildren}
                        onClear={() => setFilterChildren([])}
                        open={childFilterOpen}
                        onOpenChange={setChildFilterOpen}
                        active={filterChildren.length > 0}
                        icon={Filter}
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium">Visibility</th>
                  <th className="w-[72px] px-2 py-2 font-medium" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => (
                  <tr
                    key={c.id}
                    className={cn(
                      "border-t border-border cursor-pointer",
                      idx % 2 === 0 ? "bg-background" : "bg-[#FAF8F5]",
                      "hover:bg-background-secondary/50"
                    )}
                    onClick={() => openDetail(c)}
                  >
                    <td
                      className="px-3 py-1.5 w-10 align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        aria-label={`Select contact ${c.name}`}
                        className="rounded border-border"
                      />
                    </td>
                    <td className="px-3 py-1.5 align-middle min-w-0">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-semibold text-foreground overflow-hidden text-ellipsis whitespace-nowrap block">
                          {c.name}
                        </span>
                        {(c.email || c.visibility) && (
                          <span className="text-[11px] text-foreground-secondary overflow-hidden text-ellipsis whitespace-nowrap block">
                            {c.email ?? ""}
                            {c.email && c.visibility ? " • " : ""}
                            {c.visibility === "parents"
                              ? "Parents only"
                              : c.visibility === "family"
                                ? "Family"
                                : c.visibility === "private"
                                  ? "Just me"
                                  : c.visibility}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-foreground-secondary align-middle">
                      {c.role ? (
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                            getRoleBadgeClasses(c.role)
                          )}
                        >
                          {c.role}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-foreground-secondary align-middle">
                      {c.organization ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-foreground-secondary align-middle">
                      {c.phone ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-foreground-secondary align-middle">
                      {c.child_ids.length === 0 ? (
                        "—"
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {c.child_ids.slice(0, 2).map((id) => {
                            const info = childAvatarMap[id];
                            const label = info?.name ?? c.child_names.find((n) => n.startsWith(info?.name ?? "")) ?? "";
                            return (
                              <div key={id} className="flex items-center gap-1">
                                {info?.profile_image ? (
                                  <img
                                    src={info.profile_image}
                                    alt={info.name}
                                    className="h-6 w-6 rounded-full object-cover border border-border/60 bg-emerald-50"
                                  />
                                ) : (
                                  <div className="h-6 w-6 rounded-full bg-emerald-50 text-emerald-800 flex items-center justify-center text-[10px] font-medium">
                                    {(info?.name ?? label)?.charAt(0).toUpperCase() ?? ""}
                                  </div>
                                )}
                                <span className="text-xs text-foreground-secondary">
                                  {label || info?.name}
                                </span>
                              </div>
                            );
                          })}
                          {c.child_ids.length > 2 && (
                            <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground-secondary">
                              +{c.child_ids.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 align-middle">
                      {c.visibility === "family" ? (
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                          Family
                        </span>
                      ) : c.visibility === "private" ? (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700 gap-1">
                          <Lock className="h-3 w-3" />
                          Parents Only
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          Shared
                        </span>
                      )}
                    </td>
                    <td
                      className="px-2 py-1.5 align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          className="p-1.5 rounded text-foreground-secondary hover:text-foreground hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="Edit contact"
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="Delete contact"
                          onClick={() => handleDelete(c.id)}
                          disabled={deletingId === c.id}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {modalContact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setModalContact(null);
              setModalChildIds([]);
              setModalMode("view");
            }
          }}
        >
          <div
            className="bg-background border border-border rounded-card shadow-card max-w-md w-full p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            {modalMode === "view" && modalContact && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-heading text-base font-semibold text-foreground">
                    {modalContact.name}
                  </h3>
                  <button
                    type="button"
                    className="text-xs text-foreground-secondary hover:text-foreground underline"
                    onClick={() => {
                      setModalContact(null);
                      setModalChildIds([]);
                      setModalMode("view");
                    }}
                  >
                    Close
                  </button>
                </div>
                <div className="space-y-1 text-sm">
                  {modalContact.role && (
                    <p className="text-foreground-secondary">
                      <span className="font-medium text-foreground">Role: </span>
                      {modalContact.role}
                    </p>
                  )}
                  {modalContact.organization && (
                    <p className="text-foreground-secondary">
                      <span className="font-medium text-foreground">Organization: </span>
                      {modalContact.organization}
                    </p>
                  )}
                  {modalContact.phone && (
                    <p className="text-foreground-secondary">
                      <span className="font-medium text-foreground">Phone: </span>
                      {modalContact.phone}
                    </p>
                  )}
                  {modalContact.email && (
                    <p className="text-foreground-secondary break-words">
                      <span className="font-medium text-foreground">Email: </span>
                      {modalContact.email}
                    </p>
                  )}
                  {modalContact.address && (
                    <p className="text-foreground-secondary whitespace-pre-line">
                      <span className="font-medium text-foreground">Address: </span>
                      {modalContact.address}
                    </p>
                  )}
                  {modalContact.child_names.length > 0 && (
                    <p className="text-foreground-secondary">
                      <span className="font-medium text-foreground">Children: </span>
                      {modalContact.child_names.join(", ")}
                    </p>
                  )}
                  {modalContact.notes && (
                    <p className="text-foreground-secondary whitespace-pre-line">
                      <span className="font-medium text-foreground">Notes: </span>
                      {modalContact.notes}
                    </p>
                  )}
                </div>
                <div className="pt-2 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                    onClick={() => setModalMode("edit")}
                  >
                    Edit
                  </Button>
                </div>
              </>
            )}
            {modalMode === "edit" && modalContact && (
              <form onSubmit={handleEditSave} className="space-y-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3 className="font-heading text-base font-semibold text-foreground">
                    Edit contact
                  </h3>
                  <button
                    type="button"
                    className="text-xs text-foreground-secondary hover:text-foreground underline"
                    onClick={() => setModalMode("view")}
                  >
                    Cancel
                  </button>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="edit-name">
                    Name
                  </label>
                  <Input
                    id="edit-name"
                    name="name"
                    defaultValue={modalContact.name}
                    className="h-8 text-xs rounded-card"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="edit-role">
                    Role / type
                  </label>
                  <select
                    id="edit-role"
                    name="role"
                    defaultValue={modalContact.role ?? ""}
                    className={cn(
                      "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    )}
                  >
                    <option value="">Select role</option>
                    <option value="Doctor">Doctor</option>
                    <option value="Dentist">Dentist</option>
                    <option value="Therapist">Therapist</option>
                    <option value="Teacher">Teacher</option>
                    <option value="Coach">Coach</option>
                    <option value="Attorney">Attorney</option>
                    <option value="Mediator">Mediator</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="edit-org">
                    Practice / organization
                  </label>
                  <Input
                    id="edit-org"
                    name="organization"
                    defaultValue={modalContact.organization ?? ""}
                    className="h-8 text-xs rounded-card"
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="edit-phone">
                      Phone
                    </label>
                    <Input
                      id="edit-phone"
                      name="phone"
                      defaultValue={modalContact.phone ?? ""}
                      className="h-8 text-xs rounded-card"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="edit-email">
                      Email
                    </label>
                    <Input
                      id="edit-email"
                      name="email"
                      type="email"
                      defaultValue={modalContact.email ?? ""}
                      className="h-8 text-xs rounded-card"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="edit-address">
                    Address
                  </label>
                  <textarea
                    id="edit-address"
                    name="address"
                    defaultValue={modalContact.address ?? ""}
                    className="flex min-h-[64px] w-full rounded-card border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>
                {children.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Child</label>
                    <ChildMultiSelect
                      children={children}
                      value={modalChildIds}
                      onChange={setModalChildIds}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="edit-notes">
                    Notes
                  </label>
                  <textarea
                    id="edit-notes"
                    name="notes"
                    defaultValue={modalContact.notes ?? ""}
                    className="flex min-h-[64px] w-full rounded-card border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="edit-visibility">
                    Visibility
                  </label>
                  <select
                    id="edit-visibility"
                    name="visibility"
                    defaultValue={modalContact.visibility ?? "family"}
                    className={cn(
                      "flex h-8 w-full rounded-card border border-input bg-background px-2 py-1 text-xs",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    )}
                  >
                    <option value="family">Family</option>
                    <option value="parents">Parents only</option>
                    <option value="private">Just me</option>
                  </select>
                </div>
                <div className="flex justify-between gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="rounded-full h-8 text-xs text-red-600/90 hover:text-red-700 hover:bg-red-50"
                    onClick={async () => {
                      if (!modalContact) return;
                      await handleDelete(modalContact.id);
                      setModalContact(null);
                      setModalChildIds([]);
                      setModalMode("view");
                    }}
                  >
                    Delete
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full h-8 text-xs"
                      onClick={() => setModalMode("view")}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                      disabled={editSaving}
                    >
                      {editSaving ? "Saving…" : "Save changes"}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

