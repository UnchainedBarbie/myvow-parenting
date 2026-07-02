/**
 * Sage Understanding regression harness.
 * Run: npx tsx scripts/run-cases.ts
 * Requires ANTHROPIC_API_KEY in .env.local
 */

import { config } from "dotenv";
import { readFileSync, readdirSync, statSync } from "fs";
import { relative, resolve } from "path";
import yaml from "js-yaml";
import { interpret, type NormalizedEvent, type SageInterpretation } from "../lib/sage/understanding";

config({ path: resolve(process.cwd(), ".env.local") });

const CASES_ROOT = resolve(process.cwd(), "scripts/cases");

type CaseFile = {
  input: string;
  expected: {
    item_type?: string;
    domain?: string;
    tool_name?: string | null;
  };
  assertions?: {
    action_required?: boolean | boolean[];
    urgency?: string | string[];
    children?: string[];
  };
  notes?: string;
  difficulty: number;
};

type CaseRun = {
  id: string;
  difficulty: number;
  pass: boolean;
  failures: string[];
};

function walkYamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkYamlFiles(full));
    } else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
      out.push(full);
    }
  }
  return out.sort();
}

function loadCase(filePath: string): CaseFile {
  const raw = readFileSync(filePath, "utf8");
  const parsed = yaml.load(raw) as CaseFile;
  if (!parsed?.input?.trim()) {
    throw new Error(`Missing input in ${filePath}`);
  }
  if (!parsed.expected || typeof parsed.expected !== "object") {
    throw new Error(`Missing expected in ${filePath}`);
  }
  if (typeof parsed.difficulty !== "number") {
    throw new Error(`Missing difficulty in ${filePath}`);
  }
  return parsed;
}

function caseIdFromPath(filePath: string): string {
  return relative(CASES_ROOT, filePath).replace(/\\/g, "/");
}

function normalizeToolName(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === "null") return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/** Scalar assertion: exact match, or any value in an acceptable set. */
function assertScalar<T>(field: string, expected: T | T[], actual: T, failures: string[]): void {
  if (Array.isArray(expected)) {
    if (!expected.some((v) => v === actual)) {
      failures.push(
        `${field}: expected one of [${expected.join(", ")}], got ${String(actual)}`
      );
    }
    return;
  }
  if (actual !== expected) {
    failures.push(`${field}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

/** Expected "Child C" also matches extracted "C"; real names like "Ashley" stay exact. */
function childNameMatches(expected: string, got: string): boolean {
  const e = expected.trim().toLowerCase();
  const g = got.trim().toLowerCase();
  if (e === g) return true;
  const withoutChildPrefix = e.replace(/^child\s+/, "");
  return withoutChildPrefix !== e && g === withoutChildPrefix;
}

function evaluateCase(caseDef: CaseFile, result: SageInterpretation): string[] {
  const failures: string[] = [];
  const { expected, assertions } = caseDef;

  if (expected.item_type !== undefined && result.intent.item_type !== expected.item_type) {
    failures.push(
      `item_type: expected "${expected.item_type}", got "${result.intent.item_type}"`
    );
  }

  if (expected.domain !== undefined && result.intent.domain !== expected.domain) {
    failures.push(`domain: expected "${expected.domain}", got "${result.intent.domain}"`);
  }

  if (Object.prototype.hasOwnProperty.call(expected, "tool_name")) {
    const expectedTool = normalizeToolName(expected.tool_name);
    const gotTool = normalizeToolName(result.intent.tool_name);
    if (expectedTool !== gotTool) {
      failures.push(
        `tool_name: expected ${expectedTool === null ? "null" : `"${expectedTool}"`}, got ${gotTool === null ? "null" : `"${gotTool}"`}`
      );
    }
  }

  if (assertions?.action_required !== undefined) {
    assertScalar(
      "action_required",
      assertions.action_required,
      result.intent.action_required,
      failures
    );
  }

  if (assertions?.urgency !== undefined) {
    assertScalar("urgency", assertions.urgency, result.intent.urgency, failures);
  }

  const expectedChildren = assertions?.children ?? [];
  const gotChildNames = result.entities.children.map((c) => c.name);
  for (const name of expectedChildren) {
    const found = gotChildNames.some((n) => childNameMatches(name, n));
    if (!found) {
      failures.push(
        `children: expected "${name}" in [${gotChildNames.join(", ") || "(none)"}]`
      );
    }
  }

  return failures;
}

function printDifficultySummary(runs: CaseRun[]) {
  const byDifficulty = new Map<number, CaseRun[]>();
  for (const run of runs) {
    const group = byDifficulty.get(run.difficulty) ?? [];
    group.push(run);
    byDifficulty.set(run.difficulty, group);
  }

  console.log("");
  console.log("=== Summary by difficulty ===");
  for (const level of [...byDifficulty.keys()].sort((a, b) => a - b)) {
    const group = byDifficulty.get(level)!;
    const passed = group.filter((r) => r.pass).length;
    const pct = group.length > 0 ? Math.round((passed / group.length) * 100) : 0;
    console.log(`  Level ${level}: ${passed}/${group.length} passed (${pct}%)`);
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local and retry.");
    process.exit(1);
  }

  const files = walkYamlFiles(CASES_ROOT);
  if (files.length === 0) {
    console.error(`No YAML cases found under ${CASES_ROOT}`);
    process.exit(1);
  }

  console.log(`Running ${files.length} Sage Understanding case(s)...`);

  const runs: CaseRun[] = [];

  for (const filePath of files) {
    const caseDef = loadCase(filePath);
    const id = caseIdFromPath(filePath);

    const event: NormalizedEvent = {
      source_type: "email",
      source_id: null,
      case_id: "regression",
      sender: "coparent@example.com",
      text: caseDef.input.trim(),
    };

    const result = await interpret(event);
    const failures = evaluateCase(caseDef, result);
    const pass = failures.length === 0;

    runs.push({ id, difficulty: caseDef.difficulty, pass, failures });

    const status = pass ? "PASS" : "FAIL";
    console.log(`  ${status}  ${id}  (difficulty ${caseDef.difficulty})`);
    if (!pass) {
      for (const f of failures) {
        console.log(`         - ${f}`);
      }
    }
  }

  printDifficultySummary(runs);

  const passed = runs.filter((r) => r.pass).length;
  console.log("");
  console.log(`Overall: ${passed}/${runs.length} passed`);

  process.exit(runs.some((r) => !r.pass) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
