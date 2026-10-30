/**
 * Durable message objective.
 *
 * The recipient-facing draft is not the record of what the parent wants. This object keeps the
 * unsanitized objective, the question the message must ask, the facts it may use, private
 * constraints, and the feedback already rejected. Later drafts read this. They do not rebuild
 * the goal from the previous wording.
 */

export type GroundedFact = { text: string; status: string };

export type GroundedIn = {
  outcome: string;
  question: string;
  turns: number[];
  facts: GroundedFact[];
  uncertain: string[];
  private_constraints: string[];
  rejected: string[];
  last_guidance: string;
  evidence_refs: string[];
};

export type SelectionOption = {
  index: number;
  taskId: string;
  itemId: string | null;
  proposalId: string | null;
};

export function emptyObjective(outcome = ""): GroundedIn {
  return {
    outcome,
    question: outcome,
    turns: [],
    facts: [],
    uncertain: [],
    private_constraints: [],
    rejected: [],
    last_guidance: "",
    evidence_refs: [],
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

export function parseGroundedIn(raw: unknown): GroundedIn | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const outcome = text(row.outcome);
  const question = text(row.question) || outcome;
  if (!outcome && !question) return null;
  const facts = Array.isArray(row.facts)
    ? row.facts
        .map((fact) => {
          if (!fact || typeof fact !== "object") return null;
          const body = text((fact as { text?: unknown }).text);
          if (!body) return null;
          const status = text((fact as { status?: unknown }).status) || "parent_stated";
          return { text: body, status };
        })
        .filter((fact): fact is GroundedFact => !!fact)
    : [];
  return {
    outcome: outcome || question,
    question,
    turns: Array.isArray(row.turns) ? row.turns.filter((n): n is number => typeof n === "number") : [],
    facts,
    uncertain: stringList(row.uncertain),
    private_constraints: stringList(row.private_constraints),
    rejected: stringList(row.rejected),
    last_guidance: text(row.last_guidance),
    evidence_refs: stringList(row.evidence_refs).length > 0 ? stringList(row.evidence_refs) : evidenceRefsFrom(facts.map((fact) => fact.text).join("\n")),
  };
}

export function evidenceRefsFrom(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/\b(?:MSG|DOC|EXP|EVT)-\d+\b/gi)) refs.add(match[0].toUpperCase());
  for (const match of text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)) refs.add(match[1]);
  return [...refs];
}

export type ObjectiveParts = {
  outcome: string;
  question?: string | null;
  elicitation?: "open_question" | "predetermined_admission" | null;
  refersTo?: string | null;
  facts?: GroundedFact[];
  turns?: number[];
  uncertain?: string[];
  privateConstraints?: string[];
  disputed?: string[];
};

/**
 * Build the stored objective from an interpretation.
 * A predetermined-admission request keeps the parent's private outcome, and the question
 * falls back to what the request refers to so a legal conclusion is not the question asked.
 */
export function objectiveFromParts(parts: ObjectiveParts): GroundedIn {
  const outcome = parts.outcome.trim();
  const refersTo = parts.refersTo?.trim() ?? "";
  const explicit = parts.question?.trim() ?? "";
  const question =
    explicit ||
    (parts.elicitation === "predetermined_admission" ? refersTo || outcome : outcome);
  const facts = parts.facts ?? [];
  return {
    outcome,
    question,
    turns: parts.turns ?? [],
    facts,
    uncertain: parts.uncertain ?? [],
    private_constraints: [...(parts.privateConstraints ?? [])],
    rejected: [],
    last_guidance: "",
    evidence_refs: evidenceRefsFrom(facts.map((fact) => fact.text).join("\n")),
  };
}

function unique(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Keep the original objective and question across revisions.
 * This turn's feedback is appended. A change of outcome replaces the goal.
 */
export function mergeObjective(
  prior: GroundedIn | null,
  turn: GroundedIn,
  guidance: string,
  previousDraft: string | null,
  changeOutcome: boolean
): GroundedIn {
  const note = guidance.trim();
  if (!prior) return { ...turn, last_guidance: "", rejected: [] };
  if (changeOutcome) {
    return {
      ...turn,
      last_guidance: note || turn.last_guidance,
      rejected: note ? [note] : [],
    };
  }
  const missed = previousDraft && prior.question ? draftMissesIntendedQuestion(previousDraft, prior.question) : false;
  const rejected = unique([
    ...prior.rejected,
    ...(missed ? [note || "The previous draft did not ask the intended question."] : []),
    ...(!missed && note ? [note] : []),
  ]);
  return {
    outcome: prior.outcome || turn.outcome,
    question: prior.question || turn.question,
    turns: [...new Set([...prior.turns, ...turn.turns])],
    facts: uniqueFacts([...prior.facts, ...turn.facts]),
    uncertain: unique([...prior.uncertain, ...turn.uncertain]),
    private_constraints: unique([...prior.private_constraints, ...turn.private_constraints]),
    rejected,
    last_guidance: note || prior.last_guidance,
    evidence_refs: unique([...prior.evidence_refs, ...turn.evidence_refs]),
  };
}

function uniqueFacts(facts: GroundedFact[]): GroundedFact[] {
  const seen = new Set<string>();
  const out: GroundedFact[] = [];
  for (const fact of facts) {
    const key = fact.text.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ text: key, status: fact.status || "parent_stated" });
  }
  return out;
}

const GENERIC_QUESTION_WORDS = new Set([
  "about",
  "actual",
  "clarify",
  "confirm",
  "could",
  "message",
  "parent",
  "please",
  "position",
  "should",
  "state",
  "their",
  "whether",
  "would",
  "writing",
  "written",
]);

function contentTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 6 && !GENERIC_QUESTION_WORDS.has(word));
}

/** How much of the intended question's distinctive wording the draft carries. */
export function questionCoverage(draft: string, question: string): number {
  const required = contentTokens(question);
  if (required.length === 0) return 1;
  const present = new Set(contentTokens(draft));
  const hit = required.filter((word) => present.has(word)).length;
  return hit / required.length;
}

/**
 * True when the draft does not ask the stored question.
 * A paraphrase of a failed draft fails this check. An empty question does not.
 */
export function draftMissesIntendedQuestion(draft: string, question: string): boolean {
  const required = contentTokens(question);
  if (required.length === 0) return false;
  return questionCoverage(draft, question) < 0.5;
}

/**
 * Distinctive words from private constraints that the question does not already use.
 * Those words are strategy. They must not appear in the recipient-facing draft.
 */
export function draftExposesPrivateStrategy(
  draft: string,
  objective: Pick<GroundedIn, "question" | "private_constraints">
): boolean {
  const allowed = new Set(contentTokens(objective.question));
  const forbidden = contentTokens(objective.private_constraints.join(" ")).filter((word) => !allowed.has(word));
  if (forbidden.length === 0) return false;
  const present = new Set(contentTokens(draft));
  return forbidden.some((word) => present.has(word));
}

/** A draft is not ready when it misses the stored question or copies private strategy. */
export function draftNeedsCorrection(draft: string, objective: GroundedIn | null | undefined): boolean {
  if (!objective) return false;
  if (objective.question && draftMissesIntendedQuestion(draft, objective.question)) return true;
  return draftExposesPrivateStrategy(draft, objective);
}

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
};

/**
 * A short answer to Sage's own numbered list. Null when the message is not a selection.
 * Only meaningful when a pending selection exists.
 */
export function parseSelectionAnswer(message: string, optionCount: number): number | null {
  if (optionCount < 1) return null;
  const trimmed = message.trim();
  const indexed = trimmed.match(
    /^\s*(?:(?:use|pick|choose|work from|go with)\s+)?(?:the\s+)?(?:#|option|number|choice|draft|message)?\s*#?\s*(\d+)\s*(?:draft|one|message)?\s*\.?\s*$/i
  );
  const ordinal = trimmed.match(
    /^\s*(?:(?:use|pick|choose|work from|go with)\s+)?(?:the\s+)?(first|second|third|fourth|fifth)(?:\s+(?:one|draft|message))?\s*\.?\s*$/i
  );
  const index = indexed
    ? Number(indexed[1])
    : ordinal
      ? ORDINALS[ordinal[1].toLowerCase()] ?? 0
      : 0;
  if (!Number.isInteger(index) || index < 1 || index > optionCount) return null;
  return index;
}

export function parseSelectionOptions(raw: unknown): SelectionOption[] {
  if (!Array.isArray(raw)) return [];
  const options: SelectionOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const index = typeof row.index === "number" ? row.index : Number(row.index);
    const taskId = text(row.taskId);
    if (!Number.isInteger(index) || index < 1 || !taskId) continue;
    options.push({
      index,
      taskId,
      itemId: text(row.itemId) || null,
      proposalId: text(row.proposalId) || null,
    });
  }
  return options.sort((a, b) => a.index - b.index);
}
