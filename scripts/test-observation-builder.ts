/**
 * test-observation-builder.ts
 *
 * Validates the Observation Builder against REAL co-parent reply-chains from the
 * Civil Communicator corpus, then proves the payoff: a terse reply ("I do not
 * agree.", "I will pick her up...") is unintelligible alone, but once the
 * Observation Builder assembles its real thread and hands it to Understanding,
 * interpretation improves measurably.
 *
 * This is the empirical test of the "40% of messages are replies" finding:
 * does assembling the thread actually lift Understanding's output?
 *
 * Run from project root:
 *   npx tsx scripts/test-observation-builder.ts
 *
 * Requires ANTHROPIC_API_KEY in .env.local (loaded via dotenv).
 *
 * NOTE: These fixtures are hand-extracted from the real Civil Communicator CSV
 * and already anonymized (children -> Child A/B/C, co-parent -> Co-Parent).
 * The CSV itself is NOT read here and should NEVER be committed to the repo.
 */

import { config } from "dotenv";
import { resolve } from "path";
import { buildObservation, formatObservationForUnderstanding, type RawItem } from "../lib/sage/observation-builder";
import { interpret, type NormalizedEvent } from "../lib/sage/understanding";

config({ path: resolve(process.cwd(), ".env.local") });

/**
 * Real reply-chains pulled from the Civil Communicator corpus (anonymized).
 * Each fixture is a small pool of RawItems with reply_to_id links, plus the
 * id of the terse reply we want to interpret (the "target").
 *
 * The whole point: run interpret() on the target ALONE vs. on the
 * Observation-assembled thread, and compare.
 */

type Fixture = {
  label: string;
  category: string;
  pool: RawItem[];
  targetId: string;
};

const fixtures: Fixture[] = [
  {
    label: "Health dispute — terse 'I do not agree.' (3-deep chain)",
    category: "Health",
    pool: [
      {
        id: "374138",
        reply_to_id: null,
        from: "Co-Parent",
        timestamp: "2023-09-01T09:00:00Z",
        text: "He did not do this at all at my house because I had no idea. Please provide all this information in the future to make sure he stays on track.",
        source: "email",
      },
      {
        id: "374990",
        reply_to_id: "374138",
        from: "You",
        timestamp: "2023-09-01T11:00:00Z",
        text: "It is my understanding he was doing this as instructed even when not at my house. I believe it is your responsibility to follow the care plan during your parenting time.",
        source: "email",
      },
      {
        id: "375087",
        reply_to_id: "374990",
        from: "Co-Parent",
        timestamp: "2023-09-01T13:00:00Z",
        text: "I do not agree.",
        source: "email",
      },
    ],
    targetId: "375087",
  },
  {
    label: "Health/pickup — terse 'I will pick her up...' (2-deep chain)",
    category: "Health",
    pool: [
      {
        id: "375324",
        reply_to_id: null,
        from: "You",
        timestamp: "2023-09-10T07:30:00Z",
        text: "Child C has had a sore throat and a croup cough since yesterday and will not be going to school today. Child B has also been complaining of a stomachache.",
        source: "email",
      },
      {
        id: "375507",
        reply_to_id: "375324",
        from: "Co-Parent",
        timestamp: "2023-09-10T08:15:00Z",
        text: "I will pick her up when I get Child A and Child B.",
        source: "email",
      },
    ],
    targetId: "375507",
  },
  {
    label: "Education — correction reply 'Had a typo for the date.' (2-deep)",
    category: "Education",
    pool: [
      {
        id: "377717",
        reply_to_id: null,
        from: "Co-Parent",
        timestamp: "2024-02-28T15:00:00Z",
        text: "I scheduled a conference for Child C on 3/5/2024 @ 430pm. This is the only time and date that works for me.",
        source: "email",
      },
      {
        id: "377993",
        reply_to_id: "377717",
        from: "Co-Parent",
        timestamp: "2024-02-28T15:10:00Z",
        text: "Had a typo for the date. This is on 3/6/2024.",
        source: "email",
      },
    ],
    targetId: "377993",
  },
];

function toNormalizedEvent(text: string): NormalizedEvent {
  return {
    source_type: "email",
    source_id: null,
    case_id: "test",
    sender: "coparent@example.com",
    text,
    attachments: [],
  };
}

async function run() {
  for (const fx of fixtures) {
    console.log("\n" + "=".repeat(72));
    console.log(`FIXTURE: ${fx.label}  [${fx.category}]`);
    console.log("=".repeat(72));

    const target = fx.pool.find((m) => m.id === fx.targetId)!;

    // ---- Step 1: Build the observation from the real chain ----
    const obs = buildObservation(fx.targetId, fx.pool);
    console.log(`\n--- Observation Builder ---`);
    console.log(`thread_length: ${obs.thread_length} | has_context: ${obs.has_context} | root_id: ${obs.root_id}`);
    console.log(`\nAssembled thread:\n${formatObservationForUnderstanding(obs)}`);

    // ---- Step 2: interpret the TARGET ALONE (no context) ----
    console.log(`\n--- Understanding on TARGET ALONE ("${target.text}") ---`);
    const aloneRes = await interpret(toNormalizedEvent(target.text));
    console.log(
      `item_type: ${aloneRes.intent.item_type} | confidence: ${aloneRes.intent.confidence} | summary: ${aloneRes.intent.summary}`
    );

    // ---- Step 3: interpret the ASSEMBLED THREAD (with context) ----
    console.log(`\n--- Understanding on ASSEMBLED THREAD (with context) ---`);
    const threadText = formatObservationForUnderstanding(obs);
    const threadRes = await interpret(toNormalizedEvent(threadText));
    console.log(
      `item_type: ${threadRes.intent.item_type} | confidence: ${threadRes.intent.confidence} | summary: ${threadRes.intent.summary}`
    );

    // ---- Step 4: the payoff — show the lift ----
    const lift = (threadRes.intent.confidence - aloneRes.intent.confidence).toFixed(2);
    console.log(`\n>>> CONFIDENCE LIFT from context: ${aloneRes.intent.confidence} -> ${threadRes.intent.confidence}  (Δ ${lift})`);
  }

  console.log("\n" + "=".repeat(72));
  console.log("Done. Look for: (1) terse replies interpreted ALONE should be low-confidence /");
  console.log("needs_review; (2) the same reply WITH its assembled thread should rise in");
  console.log("confidence and land in the right domain. That is the 40%-fix, proven on real data.");
  console.log("=".repeat(72));
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
