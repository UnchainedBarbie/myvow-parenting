/**
 * Minimal unit tests for getCategoryColor.
 * Run with: npx tsx lib/categoryColors.test.ts
 */
import assert from "node:assert";
import { getCategoryColor, getCalendarEventColors } from "./categoryColors";

function run() {
  // Known category returns expected classes (medical → blue family)
  const medical = getCategoryColor("medical");
  assert.ok(medical.stripeClass.includes("7BA3C9"), "medical stripe should use blue");
  assert.ok(medical.pillBgClass.includes("7BA3C9"), "medical pill bg should use blue");
  assert.ok(medical.dotClass.includes("7BA3C9"), "medical dot should use blue");

  // Unknown category returns Other (neutral gray)
  const unknown = getCategoryColor("unknown_category_xyz");
  assert.ok(unknown.stripeClass.includes("gray"), "unknown stripe should be gray");
  assert.ok(unknown.pillBgClass.includes("gray"), "unknown pill bg should be gray");
  assert.ok(unknown.pillTextClass.includes("gray"), "unknown pill text should be gray");

  // null/undefined treated as Other
  const nil = getCategoryColor(null);
  assert.ok(nil.stripeClass.includes("gray"), "null should return other (gray)");
  const undef = getCategoryColor(undefined);
  assert.ok(undef.stripeClass.includes("gray"), "undefined should return other (gray)");

  // getCalendarEventColors returns { bg, dot } for calendar
  const cal = getCalendarEventColors("school");
  assert.strictEqual(typeof cal.bg, "string", "calendar bg should be string");
  assert.strictEqual(typeof cal.dot, "string", "calendar dot should be string");
  assert.ok(cal.dot.includes("7B9E87"), "school dot should be sage");

  console.log("categoryColors.test.ts: all assertions passed.");
}

run();
