export const RECORD_CATEGORIES = [
  { id: "health_medical", label: "Health & Medical" },
  { id: "education", label: "Education" },
  { id: "parenting_schedule", label: "Parenting Schedule" },
  { id: "finances", label: "Finances" },
  { id: "activities", label: "Activities" },
  { id: "child_wellbeing", label: "Child Wellbeing" },
  { id: "parenting_decisions", label: "Parenting Decisions" },
  { id: "legal_court", label: "Legal & Court" },
  { id: "general", label: "General" },
] as const;

export type RecordCategoryId = (typeof RECORD_CATEGORIES)[number]["id"];

const CATEGORY_IDS = new Set<string>(RECORD_CATEGORIES.map((category) => category.id));

export function isRecordCategoryId(value: string): value is RecordCategoryId {
  return CATEGORY_IDS.has(value);
}

export function recordCategoryLabel(id: string): string | null {
  return RECORD_CATEGORIES.find((category) => category.id === id)?.label ?? null;
}

export function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("does not exist") || message.includes("could not find the table");
}
