/**
 * Temporary smoke test for Sage Understanding layer.
 * Run: npx tsx scripts/test-understanding.ts
 * Requires ANTHROPIC_API_KEY in .env.local
 */

import { config } from "dotenv";
import { resolve } from "path";
import { interpret, type NormalizedEvent } from "../lib/sage/understanding";

config({ path: resolve(process.cwd(), ".env.local") });

const BASE: Omit<NormalizedEvent, "text"> = {
  source_type: "email",
  source_id: null,
  case_id: "test",
  sender: "coparent@example.com",
};

const EVENTS: { caseLabel: string; label: string; event: NormalizedEvent }[] = [
  {
    caseLabel: "Case 1",
    label: "easy schedule request",
    event: {
      ...BASE,
      text: "Do you want to start the 5:30 transition time when there isn't school now or wait until it is a signed order? The kids are out of school May 6th.",
    },
  },
  {
    caseLabel: "Case 2",
    label: "medical billing instruction",
    event: {
      ...BASE,
      text: "This should be billed to medicaid. I will contact CU to discuss it with them. In the future if you receive a bill for Child C's care, please let me know.",
    },
  },
  {
    caseLabel: "Case 3",
    label: "legal notice with deadline",
    event: {
      ...BASE,
      text: "It is my understanding mediation must take place within 49 days of 10/20/23 which is on or about 12/8/23. Glynna's availability is in the attached email as well as in the link below. Please provide a few dates/times that work for you, as well as confirm fees are acceptable.",
    },
  },
  {
    caseLabel: "Case 4",
    label: "multi-topic info + schedule request",
    event: {
      ...BASE,
      text: "I scheduled Child A's DMV appointment to get his license for Wednesday. They were booking a month out and I clearly did not pay attention to the day and grabbed the first available. Are you okay with me grabbing him from school around 1:45 and bringing him? Or would you like to and be able to?",
    },
  },
  {
    caseLabel: "Case 5a",
    label: "reply alone (no context)",
    event: {
      ...BASE,
      text: "No.",
    },
  },
  {
    caseLabel: "Case 5b",
    label: "same reply with thread context",
    event: {
      ...BASE,
      text: "Co-Parent wrote: Please double check and schedule this through children's.\nYou replied: No.",
    },
  },
  {
    caseLabel: "Case 6",
    label: "context-dependent ambiguous",
    event: {
      ...BASE,
      text: "It is my understanding she lost them at your house.",
    },
  },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local and retry.");
    process.exit(1);
  }

  for (let i = 0; i < EVENTS.length; i++) {
    const { caseLabel, label, event } = EVENTS[i];
    console.log(`\n========== ${caseLabel}: ${label} ==========`);
    console.log("Input:", event.text);
    console.log("");

    const result = await interpret(event);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
