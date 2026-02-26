/**
 * Test script: POST a simulated hostile incoming message to the ingest API.
 * Run with: npx tsx scripts/test-ingest.ts
 * Ensure the dev server is running: npm run dev
 */

const INGEST_URL = "http://localhost:3000/api/messages/ingest";
const CASE_ID = "06fee106-3013-49b8-92ad-b4f93ed9548a";

const body = {
  case_id: CASE_ID,
  original_content: `You never take the kids to their appointments. I had to leave work AGAIN to take Avery to the doctor because you can't be bothered. You're going to pay for the entire visit since this is your fault.`,
  sender_external_email: "kevin@example.com",
  // sender_id: optional — use if the co-parent has a user account; otherwise external_email identifies them
};

async function main() {
  console.log("POSTing to", INGEST_URL);
  console.log("Case ID:", CASE_ID);
  console.log("From (simulated): Kevin <kevin@example.com>");
  console.log("Message:", body.original_content);
  console.log("");

  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error("Ingest failed:", res.status, data);
    process.exit(1);
  }

  console.log("Ingest OK:", data);
  if (data.message_id) {
    console.log("Message ID:", data.message_id);
  }
}

main();
