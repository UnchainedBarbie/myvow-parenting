/**
 * Sage Understanding regression harness.
 * Run: npx tsx scripts/run-cases.ts
 * Requires ANTHROPIC_API_KEY in .env.local
 */

import { config } from "dotenv";
import { readFileSync, readdirSync, statSync } from "fs";
import { basename, join, relative, resolve } from "path";
import yaml from "js-yaml";
import { interpret, type NormalizedEvent, type SageInterpretation } from "../lib/sage/understanding";

config({ path: resolve(process.cwd(), ".env.local") });

const CASES_ROOT = resolve(process.cwd(), "scripts/cases");

type CaseFile = {
  input: string;
  expected: {
    item_type: string;
    domain: string;
    tool_name: string | null;
  };
  assertions?: {
    action_required?: boolean;
    children?: string[];
  };
  notes?: string;
  difficulty: number;
};

type CaseRun = {
  id: string;
  category: string;
  difficulty: number;
  pass: boolean;
  hardFailures: string[];
  softWarnings: string[];
  got: SageInterpretation;
};

function walkYamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
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
  if (!parsed.expected?.item_type || !parsed.expected?.domain) {
    throw new Error(`Missing expected.item_type or expected.domain in ${filePath}`);
  }
  if (typeof parsed.difficulty !== "number") {
    throw new Error(`Missing difficulty in ${filePath}`);
  }
  return parsed;
}

function categoryFromPath(filePath: string): string {
  const rel = relative(CASES_ROOT, filePath);
  const parts = rel.split(/[/\\]/);
  return parts.length > 1 ? parts[0] : "uncategorized";
}

function caseIdFromPath(filePath: string): string {
  return relative(CASES_ROOT, filePath).replace(/\\/g, "/");
}

function normalizeToolName(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === "null") return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function evaluateCase(
  caseDef: CaseFile,
  result: SageInterpretation
): { hardFailures: string[]; softWarnings: string[] } {
  const hardFailures: string[] = [];
  const softWarnings: string[] = [];

  if (result.intent.item_type !== caseDef.expected.item_type) {
    hardFailures.push(
      `item_type: expected "${caseDef.expected.item_type}", got "${result.intent.item_type}"`
    );
  }
  if (result.intent.domain !== caseDef.expected.domain) {
    hardFailures.push(
      `domain: expected "${caseDef.expected.domain}", got "${result.intent.domain}"`
    );
  }

  const expectedTool = normalizeToolName(caseDef.expected.tool_name);
  const gotTool = normalizeToolName(result.intent.tool_name);
  if (expectedTool !== gotTool) {
    hardFailures.push(
      `tool_name: expected ${expectedTool === null ? "null" : `"${expectedTool}"`}, got ${gotTool === null ? "null" : `"${gotTool}"`}`
    );
  }

  if (caseDef.assertions?.action_required !== undefined) {
    if (result.intent.action_required !== caseDef.assertions.action_required) {
      hardFailures.push(
        `action_required: expected ${caseDef.assertions.action_required}, got ${result.intent.action_required}`
      );
    }
  }

  const expectedChildren = caseDef.assertions?.children ?? [];
  const gotChildNames = result.entities.children.map((c) => c.name);
  for (const name of expectedChildren) {
    const found = gotChildNames.some(
      (n) => n.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (!found) {
      hardFailures.push(
        `children: expected "${name}" in [${gotChildNames.join(", ") || "(none)"}]`
      );
    }
  }

  const confidence = result.intent.confidence;
  if (caseDef.difficulty <= 2 && confidence < 0.7) {
    softWarnings.push(
      `confidence ${confidence.toFixed(2)} below 0.7 for difficulty ${caseDef.difficulty} (expected confident read)`
    );
  }
  if (
    caseDef.expected.item_type === "needs_review" &&
    caseDef.difficulty >= 4 &&
    confidence > 0.7
  ) {
    softWarnings.push(
      `confidence ${confidence.toFixed(2)} above 0.7 for needs_review case at difficulty ${caseDef.difficulty} (expected uncertain)`
    );
  }

  return { hardFailures, softWarnings };
}

function pad(str: string, width: number): string {
  return str.length >= width ? str.slice(0, width - 1) + "…" : str.padEnd(width);
}

function printResultsTable(runs: CaseRun[]) {
  const idW = Math.max(28, ...runs.map((r) => r.id.length));
  const catW = Math.max(14, ...runs.map((r) => r.category.length));

  console.log("");
  console.log(
    `${pad("CASE", idW)}  ${pad("CATEGORY", catW)}  DIFF  RESULT  DETAIL`
  );
  console.log(`${"-".repeat(idW)}  ${"-".repeat(catW)}  ----  ------  ------`);

  for (const run of runs) {
    const status = run.pass ? "PASS" : "FAIL";
    const detail = run.pass
      ? run.softWarnings.length > 0
        ? `${run.softWarnings.length} soft warning(s)`
        : ""
      : run.hardFailures[0] ?? "failed";
    console.log(
      `${pad(run.id, idW)}  ${pad(run.category, catW)}  ${String(run.difficulty).padStart(4)}  ${status.padEnd(6)}  ${detail}`
    );
  }
}

function printBreakdown(
  label: string,
  runs: CaseRun[],
  keyFn: (r: CaseRun) => string
) {
  const groups = new Map<string, CaseRun[]>();
  for (const run of runs) {
    const key = keyFn(run);
    const list = groups.get(key) ?? [];
    list.push(run);
    groups.set(key, list);
  }

  console.log("");
  console.log(`=== Accuracy by ${label} ===`);
  for (const [key, group] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const passed = group.filter((r) => r.pass).length;
    const pct = group.length > 0 ? Math.round((passed / group.length) * 100) : 0;
    console.log(`  ${key}: ${passed}/${group.length} (${pct}%)`);
  }
}

function printSoftWarnings(runs: CaseRun[]) {
  const withWarnings = runs.filter((r) => r.softWarnings.length > 0);
  if (withWarnings.length === 0) return;

  console.log("");
  console.log("=== Soft-check warnings (non-failing) ===");
  for (const run of withWarnings) {
    for (const w of run.softWarnings) {
      console.log(`  ${run.id}: ${w}`);
    }
  }
}

function printHardFailures(runs: CaseRun[]) {
  const failed = runs.filter((r) => !r.pass);
  if (failed.length === 0) return;

  console.log("");
  console.log("=== Hard assertion failures ===");
  for (const run of failed) {
    console.log(`  ${run.id}:`);
    for (const f of run.hardFailures) {
      console.log(`    - ${f}`);
    }
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
    const event: NormalizedEvent = {
      source_type: "email",
      source_id: null,
      case_id: "regression",
      sender: "coparent@example.com",
      text: caseDef.input.trim(),
    };

    const got = await interpret(event);
    const { hardFailures, softWarnings } = evaluateCase(caseDef, got);

    runs.push({
      id: caseIdFromPath(filePath),
      category: categoryFromPath(filePath),
      difficulty: caseDef.difficulty,
      pass: hardFailures.length === 0,
      hardFailures,
      softWarnings,
      got,
    });
  }

  printResultsTable(runs);
  printBreakdown("CATEGORY", runs, (r) => r.category);
  printBreakdown("DIFFICULTY", runs, (r) => `level ${r.difficulty}`);
  printSoftWarnings(runs);
  printHardFailures(runs);

  const passed = runs.filter((r) => r.pass).length;
  console.log("");
  console.log(`Overall: ${passed}/${runs.length} passed (hard assertions)`);

  const anyFail = runs.some((r) => !r.pass);
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
