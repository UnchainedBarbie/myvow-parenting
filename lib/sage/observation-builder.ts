/**
 * Sage Engine — Observation Builder.
 * Deterministic preprocessing: assembles thread context from RawItems (no AI, no I/O).
 * v1: email/message reply-links. Future: court filings, receipts + OCR, etc.
 */

export type RawItem = {
  id: string;
  reply_to_id: string | null;
  from: string;
  timestamp: string;
  text: string;
  source: string;
  attachments?: { filename: string; text?: string }[];
};

export type Observation = {
  target_id: string;
  root_id: string | null;
  messages: RawItem[];
  thread_length: number;
  has_context: boolean;
  source: string;
};

function parseTime(ts: string): number {
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Walk reply_to_id backward from target, collecting ancestors.
 * v1: ancestors + target only. Sibling/descendant collection can be added later.
 */
export function buildObservation(targetId: string, inputs: RawItem[]): Observation {
  const byId = new Map(inputs.map((item) => [item.id, item]));
  const target = byId.get(targetId);
  if (!target) {
    throw new Error(`Target ${targetId} not found in inputs`);
  }

  const collected: RawItem[] = [];
  const visited = new Set<string>();
  let current: RawItem | undefined = target;

  while (current) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    collected.push(current);

    const parentId = current.reply_to_id;
    if (!parentId) break;

    const parent = byId.get(parentId);
    if (!parent) break;

    current = parent;
  }

  const messages = [...collected].sort(
    (a, b) => parseTime(a.timestamp) - parseTime(b.timestamp)
  );

  const thread_length = messages.length;
  const has_context = thread_length > 1;

  let root_id: string | null = null;
  if (target.reply_to_id !== null) {
    const rootItem = messages.find((m) => m.reply_to_id === null);
    root_id = rootItem?.id ?? null;
  }

  return {
    target_id: targetId,
    root_id,
    messages,
    thread_length,
    has_context,
    source: target.source,
  };
}

function formatSenderLabel(from: string): string {
  const f = from.trim().toLowerCase();
  if (f === "you" || f === "self" || f === "parent" || f === "user") return "You";
  if (f === "coparent" || f === "co-parent") return "Co-Parent";
  return from.trim() || "Unknown";
}

function formatShortDate(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) {
    const slice = timestamp.trim().slice(0, 10);
    return slice || timestamp.trim();
  }
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

/**
 * Format an Observation as plain text for the Understanding layer.
 */
export function formatObservationForUnderstanding(obs: Observation): string {
  return obs.messages
    .map((m) => {
      const label = formatSenderLabel(m.from);
      const date = formatShortDate(m.timestamp);
      const body = m.text.trim();
      return `From: ${label} (${date}): ${body}`;
    })
    .join("\n");
}
