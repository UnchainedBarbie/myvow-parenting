/**
 * Shadow interpreter for parent Sage chat.
 * Enabled only when SAGE_SHADOW_INTERPRETER is true, 1, on, or yes.
 * The chat response does not wait. On Vercel, waitUntil keeps the invocation
 * alive until the comparison reaches one terminal outcome.
 *
 * Comparisons are one JSON line on stdout, prefixed [sage/shadow].
 * Count the metric field: agree, partial, disagree, or failure.
 */

import { waitUntil } from "@vercel/functions";
import {
  SHADOW_TOOL,
  SHADOW_TOOL_NAME,
  buildShadowPacket,
  comparisonRecord,
  compareSnapshots,
  routerSnapshot,
  validateShadowOutput,
  type RouterSnapshot,
  type ShadowComparisonRecord,
  type ShadowTurnInput,
} from "@/lib/sage/shadow-contract";

const SAGE_MODEL = "claude-sonnet-4-6";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TIMEOUT_MS = 12000;

const SYSTEM_PROMPT = `You classify one parent message in a co-parenting app.
Choose the parent's intention. A message may contain more than one intention.
Use only the handles in the packet. Leave a handle empty when you do not have one.
Do not invent database ids, case ids, email addresses, permissions, or expense percentages.
You cannot save records, send messages, or complete an action.
Set needs_clarification when a required field is missing.
Supplying a missing detail is supply_missing, not a new record.
A payment the parent already made is an expense, even when it mentions an appointment.
Finding a saved document is retrieve. Changing its description is update.
Advice about what to say is advice, not message_coparent, unless the parent asks you to prepare the message.
continuation.open means a clarification is still waiting. Answer it with supply_missing and context_handle only when this message supplies the missing detail.
A different domain, child, or explicit new request is a new intention. Leave target_handle empty unless the packet lists the record to change.`;

export type ShadowDeps = {
  fetchImpl?: typeof fetch;
  enabled?: boolean;
  timeoutMs?: number;
  log?: (record: ShadowComparisonRecord) => void;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  /** Test hook. Production uses Vercel waitUntil. */
  keepAlive?: (work: Promise<unknown>) => void;
};

const turnsInFlight = new Set<string>();

export type ShadowScheduleResult = "disabled" | "duplicate" | "started";

export function shadowInterpreterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.SAGE_SHADOW_INTERPRETER ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

export function emitShadowComparison(record: ShadowComparisonRecord): void {
  console.info(`[sage/shadow] ${JSON.stringify(record)}`);
}

/**
 * Register one shadow comparison for this request.
 * The returned promise is handed to waitUntil so Vercel can finish it after
 * the parent response is sent. The caller does not await it.
 */
export function scheduleShadowComparison(
  input: ShadowTurnInput,
  deps: ShadowDeps = {}
): ShadowScheduleResult {
  const enabled = deps.enabled ?? shadowInterpreterEnabled(deps.env);
  if (!enabled) return "disabled";
  const key = input.turnKey?.trim() ?? "";
  if (key && turnsInFlight.has(key)) return "duplicate";
  if (key) turnsInFlight.add(key);

  const work = runShadowInterpreter(input, { ...deps, enabled: true })
    .then((record) => {
      writeShadowLog(record, deps.log);
      return record;
    })
    .catch(() => {
      writeShadowLog(
        comparisonRecord({
          outcome: "api_error",
          router: routerSnapshot(input.router),
          latencyMs: 0,
        }),
        deps.log
      );
    })
    .finally(() => {
      if (key) turnsInFlight.delete(key);
    });

  const keepAlive = deps.keepAlive ?? keepShadowAlive;
  try {
    keepAlive(work);
  } catch {
    console.error("[sage/shadow] request lifetime hook failed");
  }
  return "started";
}

/** Keeps the shadow promise alive for the rest of this Vercel invocation. */
export function keepShadowAlive(work: Promise<unknown>): void {
  try {
    waitUntil(work);
  } catch {
    console.error("[sage/shadow] waitUntil failed");
  }
}

function writeShadowLog(
  record: ShadowComparisonRecord,
  log: ShadowDeps["log"]
): void {
  try {
    (log ?? emitShadowComparison)(record);
  } catch {
    console.error("[sage/shadow] comparison log failed");
  }
}

export async function runShadowInterpreter(
  input: ShadowTurnInput,
  deps: ShadowDeps = {}
): Promise<ShadowComparisonRecord> {
  const started = (deps.now ?? Date.now)();
  const router = routerSnapshot(input.router);
  const enabled = deps.enabled ?? shadowInterpreterEnabled(deps.env);
  if (!enabled) {
    return comparisonRecord({
      outcome: "disabled",
      router,
      latencyMs: 0,
    });
  }

  const timeoutMs =
    deps.timeoutMs != null
      ? Math.min(MAX_TIMEOUT_MS, Math.max(20, Math.round(deps.timeoutMs)))
      : clampTimeout(readTimeout(deps.env));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const packet = buildShadowPacket(input);
    const fetchImpl = deps.fetchImpl ?? fetch;
    const configured = (deps.env ?? process.env).ANTHROPIC_API_KEY?.trim() ?? "";
    const apiKey = configured || (deps.fetchImpl ? "shadow-test" : "");
    if (!apiKey) {
      return finish(router, "api_error", started, deps, null, null);
    }
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: SAGE_MODEL,
        max_tokens: 700,
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [SHADOW_TOOL],
        tool_choice: { type: "tool", name: SHADOW_TOOL_NAME },
        messages: [{ role: "user", content: packet.prompt }],
      }),
    });
    if (!response.ok) {
      const failure = await readShadowError(response);
      return finish(router, "api_error", started, deps, null, response.status, failure);
    }
    const body: unknown = await response.json();
    const toolInput = extractToolInput(body);
    const validated = toolInput ? validateShadowOutput(toolInput, packet.catalog) : null;
    if (!validated) {
      return finish(router, "invalid_schema", started, deps, null, response.status);
    }
    return finish(router, "compared", started, deps, validated, response.status);
  } catch (error) {
    const outcome = isAbort(error) ? "timeout" : "api_error";
    return finish(router, outcome, started, deps, null, null);
  } finally {
    clearTimeout(timer);
  }
}

function finish(
  router: RouterSnapshot,
  outcome: ShadowComparisonRecord["outcome"],
  started: number,
  deps: ShadowDeps,
  shadow: ReturnType<typeof validateShadowOutput>,
  httpStatus: number | null,
  failure?: { errorCategory: string; diagnostic: string } | null
): ShadowComparisonRecord {
  const latencyMs = Math.max(0, (deps.now ?? Date.now)() - started);
  return comparisonRecord({
    outcome,
    router,
    shadow,
    agreement: shadow ? compareSnapshots(router, shadow) : null,
    latencyMs,
    httpStatus,
    errorCategory: failure?.errorCategory ?? null,
    diagnostic: failure?.diagnostic ?? null,
  });
}

const SCHEMA_CONSTRAINTS = new Set([
  "maxitems",
  "minitems",
  "additionalproperties",
  "unevaluatedproperties",
  "minimum",
  "maximum",
  "minlength",
  "maxlength",
  "pattern",
  "format",
]);

/** Maps an Anthropic error to a category and code. The response text is not returned. */
export function classifyShadowError(
  status: number,
  body: unknown
): { errorCategory: string; diagnostic: string } {
  const error =
    body && typeof body === "object" ? (body as { error?: { type?: unknown; message?: unknown } }).error : null;
  const type = typeof error?.type === "string" ? error.type : "";
  const message = typeof error?.message === "string" ? error.message : "";
  const unsupported = message.match(/property '([A-Za-z0-9_]+)' is not supported/i);
  const constraint = unsupported?.[1]?.toLowerCase() ?? "";
  const errorCategory =
    status === 401 || status === 403 || type === "authentication_error"
      ? "authentication"
      : status === 429 || type === "rate_limit_error"
        ? "rate_limit"
        : status >= 500 || type === "api_error" || type === "overloaded_error"
          ? "server"
          : "invalid_request";
  const diagnostic =
    constraint && SCHEMA_CONSTRAINTS.has(constraint) ? `unsupported_${constraint}` : errorCategory;
  return { errorCategory, diagnostic };
}

async function readShadowError(response: Response): Promise<{ errorCategory: string; diagnostic: string }> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return classifyShadowError(response.status, body);
}

function extractToolInput(data: unknown): unknown | null {
  if (!data || typeof data !== "object") return null;
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const block = content.find(
    (entry) =>
      !!entry &&
      typeof entry === "object" &&
      (entry as { type?: unknown }).type === "tool_use" &&
      (entry as { name?: unknown }).name === SHADOW_TOOL_NAME
  );
  if (!block || typeof block !== "object") return null;
  const input = (block as { input?: unknown }).input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input;
}

function readTimeout(env: NodeJS.ProcessEnv | undefined): number {
  const raw = Number((env ?? process.env).SAGE_SHADOW_INTERPRETER_TIMEOUT_MS);
  return Number.isFinite(raw) ? raw : DEFAULT_TIMEOUT_MS;
}

function clampTimeout(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(200, Math.round(value)));
}

function isAbort(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { name?: string }).name === "AbortError";
}
