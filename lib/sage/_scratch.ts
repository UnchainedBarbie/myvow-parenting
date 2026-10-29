import { routeChatIntent } from "@/lib/sage/chat-intent";

const messages = [
  "Can you draft a message to Kevin asking him to clarify whether agreement on a new pediatrician depends on vaccination decisions?",
  "Draft a message asking my co-parent to clarify his position on the new pediatrician and whether it depends on vaccines.",
  "Can you draft something?",
  "Please write to Kevin about the pediatrician and vaccination policy and ask for his position in writing.",
];
for (const message of messages) {
  const r = routeChatIntent({
    message,
    coparents: [{ name: "Kevin", email: "kevin@example.com" }],
    children: [{ id: "c1", name: "Ashley Example" }],
    today: new Date("2026-10-28T18:00:00Z"),
  });
  console.log("MSG:", message);
  console.log("handled:", r.handled, "reply:", r.reply);
  console.log(JSON.stringify(r.result.plan.proposals.map((p) => ({ type: p.type, draft: p.draft, title: (p as { title?: string }).title })), null, 1));
}
