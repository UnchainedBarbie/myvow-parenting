/**
 * Minimal tests for document upload validation: description length, null child.
 * Run with: npx tsx lib/documents/validation.test.ts
 */
import assert from "node:assert";

const DESCRIPTION_MAX = 250;

function validateDescription(description: string | null | undefined): { valid: boolean; error?: string } {
  const trimmed = description?.trim() ?? "";
  if (trimmed.length === 0) return { valid: false, error: "Description is required." };
  if (trimmed.length > DESCRIPTION_MAX) return { valid: false, error: `Description must be ${DESCRIPTION_MAX} characters or fewer.` };
  return { valid: true };
}

function normalizeChildId(childId: string | null | undefined): string | null {
  const v = childId?.trim();
  return v && v.length > 0 ? v : null;
}

function run() {
  const d250 = "a".repeat(250);
  const d251 = "a".repeat(251);

  assert.strictEqual(validateDescription(null).valid, false);
  assert.strictEqual(validateDescription("").valid, false);
  assert.strictEqual(validateDescription("   ").valid, false);
  assert.strictEqual(validateDescription("ok").valid, true);
  assert.strictEqual(validateDescription(d250).valid, true);
  assert.strictEqual(validateDescription(d251).valid, false);

  assert.strictEqual(normalizeChildId(null), null);
  assert.strictEqual(normalizeChildId(""), null);
  assert.strictEqual(normalizeChildId("  "), null);
  assert.strictEqual(normalizeChildId("child-uuid"), "child-uuid");

  console.log("lib/documents/validation.test.ts: all assertions passed.");
}

run();
