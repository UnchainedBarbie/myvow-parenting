 "use client";

 import { useMemo, useState } from "react";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { cn } from "@/lib/utils";
 import { ColumnFilterPopover, type ColumnFilterOption } from "@/components/documents/column-filter-popover";
 import { Download, Trash2 } from "lucide-react";
 import { ConfirmModal } from "@/components/ui/confirm-modal";
 import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";

const TYPE_LABELS: Record<string, string> = {
  messages: "Message transcript",
  expenses: "Expense ledger",
  patterns: "Pattern summary",
  full_report: "Full case report",
  communication_report: "Communication Report",
  expense_report: "Expense Report",
  calendar_report: "Calendar & Custody Report",
  document_index: "Document Index",
  interaction_log: "Interaction Log",
  full_case_report: "Full Case Report",
};

 export type ExportRow = {
   id: string;
   export_type: string;
   date_range_start: string | null;
   date_range_end: string | null;
   file_path: string | null;
   verification_hash: string | null;
   record_count: number | null;
   created_at: string;
 };

 interface ExportListProps {
   exports: ExportRow[];
 }

 function formatDate(createdAt: string) {
   return new Date(createdAt).toLocaleString("en-US", {
     month: "short",
     day: "numeric",
     year: "numeric",
     hour: "numeric",
     minute: "2-digit",
   });
 }

 function formatRange(start: string | null, end: string | null) {
   if (!start && !end) return "All dates";
   if (!start) return `Through ${end ? new Date(end).toLocaleDateString() : "—"}`;
   if (!end) return `From ${new Date(start).toLocaleDateString()}`;
   return `${new Date(start).toLocaleDateString()} – ${new Date(end).toLocaleDateString()}`;
 }

 function getFormatFromPath(path: string | null): string | null {
   if (!path) return null;
   const ext = path.split(".").pop()?.toLowerCase();
   if (!ext) return null;
   return ext;
 }

 function bucketRecordCount(count: number | null): string {
   if (count == null || count < 0) return "unknown";
   if (count <= 9) return "0-9";
   if (count <= 99) return "10-99";
   if (count <= 999) return "100-999";
   return "1000+";
 }

 type GeneratedPreset = "last7" | "last30" | "thisYear";

 export function ExportList({ exports: exportList }: ExportListProps) {
   const [rows, setRows] = useState(() => exportList);

   // Filters
   const [typeFilter, setTypeFilter] = useState<string[]>([]);
   const [rangeFilter, setRangeFilter] = useState<string[]>([]);
   const [generatedFilter, setGeneratedFilter] = useState<GeneratedPreset[]>([]);
   const [recordsFilter, setRecordsFilter] = useState<string[]>([]);
   const [formatFilter, setFormatFilter] = useState<string[]>([]);
   const [hashFilter, setHashFilter] = useState<string[]>([]);

   const [typeOpen, setTypeOpen] = useState(false);
   const [rangeOpen, setRangeOpen] = useState(false);
   const [generatedOpen, setGeneratedOpen] = useState(false);
   const [recordsOpen, setRecordsOpen] = useState(false);
   const [formatOpen, setFormatOpen] = useState(false);
   const [hashOpen, setHashOpen] = useState(false);

   const [deleteId, setDeleteId] = useState<string | null>(null);

   const typeOptions: ColumnFilterOption[] = useMemo(() => {
     const values = new Set<string>();
     rows.forEach((r) => values.add(r.export_type));
     return Array.from(values).map((v) => ({
       value: v,
       label: TYPE_LABELS[v] ?? v,
     }));
   }, [rows]);

   const hasAnyRange = useMemo(
     () => rows.some((r) => r.date_range_start || r.date_range_end),
     [rows]
   );

   const formatOptions: ColumnFilterOption[] = useMemo(() => {
     const values = new Set<string>();
     rows.forEach((r) => {
       const f = getFormatFromPath(r.file_path);
       if (f) values.add(f);
     });
     return Array.from(values).map((v) => ({
       value: v,
       label: v.toUpperCase(),
     }));
   }, [rows]);

   const filteredRows = useMemo(() => {
     let out = [...rows];

     // by type
     if (typeFilter.length > 0) {
       out = out.filter((r) => typeFilter.includes(r.export_type));
     }

     // has date range
     if (rangeFilter.includes("has")) {
       out = out.filter((r) => r.date_range_start || r.date_range_end);
     }

     // generated preset(s)
     if (generatedFilter.length > 0) {
       out = out.filter((r) => {
         const created = new Date(r.created_at);
         const now = new Date();
         const yearStart = new Date(now.getFullYear(), 0, 1);

         return generatedFilter.some((preset) => {
           if (preset === "last7") {
             const cutoff = new Date();
             cutoff.setDate(cutoff.getDate() - 7);
             return created >= cutoff;
           }
           if (preset === "last30") {
             const cutoff = new Date();
             cutoff.setDate(cutoff.getDate() - 30);
             return created >= cutoff;
           }
           if (preset === "thisYear") {
             return created >= yearStart;
           }
           return true;
         });
       });
     }

     // record buckets
     if (recordsFilter.length > 0) {
       out = out.filter((r) => recordsFilter.includes(bucketRecordCount(r.record_count)));
     }

     // format
     if (formatFilter.length > 0) {
       out = out.filter((r) => {
         const f = getFormatFromPath(r.file_path);
         return f && formatFilter.includes(f);
       });
     }

     // hash
     if (hashFilter.includes("has")) {
       out = out.filter((r) => !!r.verification_hash);
     }

     return out;
   }, [rows, typeFilter, rangeFilter, generatedFilter, recordsFilter, formatFilter, hashFilter]);

   const hasFiltersActive =
     typeFilter.length > 0 ||
     rangeFilter.length > 0 ||
     generatedFilter.length > 0 ||
     recordsFilter.length > 0 ||
     formatFilter.length > 0 ||
     hashFilter.length > 0;

   function clearFilters() {
     setTypeFilter([]);
     setRangeFilter([]);
     setGeneratedFilter([]);
     setRecordsFilter([]);
     setFormatFilter([]);
     setHashFilter([]);
   }

   function handleDownload(id: string) {
     window.open(`/api/reports/download/${id}`, "_blank");
   }

   async function handleDelete(id: string) {
     try {
       const res = await fetch(`/api/reports/delete/${id}`, { method: "DELETE" });
       const data = await res.json().catch(() => ({}));
       if (!res.ok) {
         showErrorToast((data as { message?: string }).message ?? "Failed to delete report.");
         return;
       }
       setRows((prev) => prev.filter((r) => r.id !== id));
       showSuccessToast("Report deleted.");
     } catch {
       showErrorToast("Failed to delete report.");
     } finally {
       setDeleteId(null);
     }
   }

   return (
     <>
       <Card className="shadow-card">
         <CardHeader className="flex flex-row items-center justify-between gap-2">
           <CardTitle className="font-heading text-lg">Previous Reports</CardTitle>
           {hasFiltersActive && (
             <button
               type="button"
               onClick={clearFilters}
               className="text-xs text-foreground-secondary hover:text-foreground hover:underline"
             >
               Clear filters
             </button>
           )}
         </CardHeader>
         <CardContent>
           {rows.length === 0 ? (
             <p className="text-sm text-foreground-secondary py-6">
               No exports yet. Generate one above.
             </p>
           ) : filteredRows.length === 0 ? (
             <p className="text-sm text-foreground-secondary py-6">
               No reports match these filters.
             </p>
           ) : (
             <div className="overflow-x-auto rounded-card border border-border bg-background">
               <table className="min-w-full table-fixed text-xs md:text-sm">
                 <colgroup>
                   <col style={{ width: "26%" }} />
                   <col style={{ width: "22%" }} />
                   <col style={{ width: "18%" }} />
                   <col style={{ width: "12%" }} />
                   <col style={{ width: "14%" }} />
                   <col style={{ width: "8%" }} />
                 </colgroup>
                 <thead>
                   <tr className="bg-[#E7EFE8]/80 text-foreground-secondary sticky top-0 z-10">
                     <th className="px-3 py-2 font-medium text-left">
                       <span className="inline-flex items-center gap-1">
                         <span>Report</span>
                         <ColumnFilterPopover
                           title="Report type"
                           options={typeOptions}
                           selected={typeFilter}
                           onApply={setTypeFilter}
                           onClear={() => setTypeFilter([])}
                           open={typeOpen}
                           onOpenChange={setTypeOpen}
                           active={typeFilter.length > 0}
                         />
                       </span>
                     </th>
                     <th className="px-3 py-2 font-medium text-left">
                       <span className="inline-flex items-center gap-1">
                         <span>Date range</span>
                         {hasAnyRange && (
                           <ColumnFilterPopover
                             title="Date range"
                             options={[{ value: "has", label: "Has date range" }]}
                             selected={rangeFilter}
                             onApply={setRangeFilter}
                             onClear={() => setRangeFilter([])}
                             open={rangeOpen}
                             onOpenChange={setRangeOpen}
                             active={rangeFilter.length > 0}
                           />
                         )}
                       </span>
                     </th>
                     <th className="px-3 py-2 font-medium text-left">
                       <span className="inline-flex items-center gap-1">
                         <span>Generated</span>
                         <ColumnFilterPopover
                           title="Generated"
                           options={[
                             { value: "last7", label: "Last 7 days" },
                             { value: "last30", label: "Last 30 days" },
                             { value: "thisYear", label: "This year" },
                           ]}
                           selected={generatedFilter}
                           onApply={(vals) => setGeneratedFilter(vals as GeneratedPreset[])}
                           onClear={() => setGeneratedFilter([])}
                           open={generatedOpen}
                           onOpenChange={setGeneratedOpen}
                           active={generatedFilter.length > 0}
                         />
                       </span>
                     </th>
                     <th className="px-3 py-2 font-medium text-right">
                       <span className="inline-flex items-center gap-1 justify-end w-full">
                         <span>Records</span>
                         <ColumnFilterPopover
                           title="Records"
                           options={[
                             { value: "0-9", label: "0–9" },
                             { value: "10-99", label: "10–99" },
                             { value: "100-999", label: "100–999" },
                             { value: "1000+", label: "1000+" },
                           ]}
                           selected={recordsFilter}
                           onApply={setRecordsFilter}
                           onClear={() => setRecordsFilter([])}
                           open={recordsOpen}
                           onOpenChange={setRecordsOpen}
                           active={recordsFilter.length > 0}
                         />
                       </span>
                     </th>
                     <th className="px-3 py-2 font-medium text-left">
                       <span className="inline-flex items-center gap-1">
                         <span>Hash</span>
                         <ColumnFilterPopover
                           title="Verification hash"
                           options={[{ value: "has", label: "Has hash" }]}
                           selected={hashFilter}
                           onApply={setHashFilter}
                           onClear={() => setHashFilter([])}
                           open={hashOpen}
                           onOpenChange={setHashOpen}
                           active={hashFilter.length > 0}
                         />
                       </span>
                     </th>
                     <th className="px-3 py-2 font-medium text-right">
                       <span className="inline-flex items-center justify-end gap-1 w-full">
                         <span>Actions</span>
                         {formatOptions.length > 0 && (
                           <ColumnFilterPopover
                             title="Format"
                             options={formatOptions}
                             selected={formatFilter}
                             onApply={setFormatFilter}
                             onClear={() => setFormatFilter([])}
                             open={formatOpen}
                             onOpenChange={setFormatOpen}
                             active={formatFilter.length > 0}
                           />
                         )}
                       </span>
                     </th>
                   </tr>
                 </thead>
                 <tbody>
                   {filteredRows.map((row) => {
                     const format = getFormatFromPath(row.file_path);
                     return (
                       <tr
                         key={row.id}
                         className={cn(
                           "border-t border-border",
                           "hover:bg-muted/40 transition-colors"
                         )}
                       >
                         <td className="px-3 py-2 align-middle">
                           <div className="flex flex-col gap-0.5 min-w-0">
                             <span className="font-medium text-foreground truncate">
                               {TYPE_LABELS[row.export_type] ?? row.export_type}
                             </span>
                           </div>
                         </td>
                         <td className="px-3 py-2 align-middle text-foreground-secondary">
                           <span className="truncate block">
                             {formatRange(row.date_range_start, row.date_range_end)}
                           </span>
                         </td>
                         <td className="px-3 py-2 align-middle text-foreground-secondary">
                           {formatDate(row.created_at)}
                         </td>
                         <td className="px-3 py-2 align-middle text-right text-foreground-secondary">
                           {row.record_count != null ? row.record_count : "—"}
                         </td>
                         <td className="px-3 py-2 align-middle">
                           {row.verification_hash ? (
                             <span className="font-mono text-[11px] text-foreground-secondary">
                               {row.verification_hash.slice(0, 12)}…
                             </span>
                           ) : (
                             <span className="text-[11px] text-foreground-secondary">—</span>
                           )}
                         </td>
                         <td className="px-3 py-2 align-middle">
                           <div className="flex items-center justify-end gap-1.5">
                             {format && (
                               <span className="text-[10px] uppercase text-foreground-secondary">
                                 {format}
                               </span>
                             )}
                             {row.file_path && (
                               <button
                                 type="button"
                                 className="p-1.5 rounded-full text-foreground-secondary hover:text-foreground hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                 aria-label="Download report"
                                 onClick={() => handleDownload(row.id)}
                               >
                                 <Download className="h-3.5 w-3.5" />
                               </button>
                             )}
                             <button
                               type="button"
                               className="p-1.5 rounded-full text-foreground-secondary hover:text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                               aria-label="Delete report"
                               onClick={() => setDeleteId(row.id)}
                             >
                               <Trash2 className="h-3.5 w-3.5" />
                             </button>
                           </div>
                         </td>
                       </tr>
                     );
                   })}
                 </tbody>
               </table>
             </div>
           )}
         </CardContent>
       </Card>

       <ConfirmModal
         open={deleteId !== null}
         title="Delete report?"
         description="This cannot be undone."
         confirmLabel="Delete"
         confirmTone="danger"
         onCancel={() => setDeleteId(null)}
         onConfirm={() => {
           const id = deleteId;
           if (!id) return;
           void handleDelete(id);
         }}
       />
     </>
   );
 }

