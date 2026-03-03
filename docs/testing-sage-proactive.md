# Manual test steps: Sage proactive support, structured pause, cool-off

## Prerequisites

- Run migrations: `supabase db push` or apply `20260302131000_sage_proactive_and_cool_off.sql`.
- Log in as a user in a case with at least one conversation.

---

## 1. Sage proactive nudges (cross-intensity)

- **Incoming nudge**
  - Have the co-parent send a message that triggers intensity (e.g. contains strong language or hostility phrases from `lib/sage/intensity.ts`).
  - As the receiving parent, open that conversation. Under the intense message you should see a pill: **"Let's talk before you respond"**.
  - Click it: Sage panel opens with that message as context ("Regarding: …" in the banner).
  - If you turn off proactive in Settings (global or per-conversation), the nudge should not appear.

- **Draft nudge**
  - In the compose box, type text that triggers intensity (e.g. ALL CAPS, profanity, or hostility phrases).
  - Above the Send button a pill should appear: **"Let's talk before you hit send"**.
  - Click it: Sage panel opens with your draft as context.
  - Clear the draft or use calmer text: the pill should disappear.

---

## 2. Structured pause

- **Suggestion card**
  - In a thread with several high-intensity messages in a short window (e.g. 3+ in 10 min or 5+ in 60 min), a card should appear: **"Would you like to take a pause?"** with options: 30 min, 2 hours, Until tomorrow morning, Continue.
  - Click **30 min** (or another duration): a pause is created; the banner **"This conversation has been temporarily paused to allow cooling. It will reopen at [time]."** appears; Send is disabled for you in that thread until the end time.
  - **Continue** dismisses the card only (no pause).

- **Auto pause**
  - Send a message that contains severe phrases (e.g. threat keywords in `lib/sage/intensity.ts`) or trigger repeated intensity in the same thread. The system may create an auto pause (both parents blocked until the auto end time). The same neutral banner appears for both.

- **Mutual pause**
  - If both parents choose a pause within 10 minutes, the pause is upgraded to mutual (both blocked).

---

## 3. Global cool-off (private buffering)

- **Start cool-off**
  - From the Messages thread header click **"Take a cool-off break"**, or from Dashboard click **"Take a cool-off break"** (opens Messages and the modal).
  - In the modal, set duration (e.g. 2 hours) and click **Start break**. Banner appears: **"You're taking a break. Sending is paused until [time]. Incoming messages will appear when your break ends."**
  - Send is disabled in all conversations. The other parent is not notified.

- **Buffered messages**
  - While you are in cool-off, have the co-parent send a message. For you, that message does not appear until your break ends.
  - For the co-parent, the message appears as sent normally.

- **Release**
  - When the cool-off end time is reached, the app (on load or on the 60s interval) calls the release endpoint. Buffered messages are marked delivered and appear in your thread. No mention of cool-off appears in climate or reports.

- **Emergency bypass** (sender side)
  - When sending, the UI can pass `is_emergency`, `emergency_type` (medical/safety/logistics), and `emergency_note`. Those messages deliver immediately even if the recipient is in cool-off. Overuse (e.g. 5+ in 7 days) temporarily disables the emergency option (no blame UI).

---

## 4. Sage panel copy

- Open Sage from the avatar next to compose. Header should show:
  - **"Sage"** and **"Private coaching — Not visible to your co-parent."**
- First message from Sage: **"How can I support you?"**

---

## 5. Settings and edit history

- **Global:** PATCH `/api/settings/user` with e.g. `{ "proactive_sage_enabled": false }`. Response returns updated settings. A row is written to `edit_history` with `scope: "global"`, `field`, `old_value`, `new_value`. Cool-off is never logged.
- **Per-conversation:** PATCH `/api/settings/conversation` with `{ "conversation_id": "...", "proactive_sage_enabled": false }`. Same pattern; `scope: "conversation"` and `conversation_id` set.

---

## 6. Quick checks

| Check | Expected |
|-------|----------|
| No red / "escalation" / blame language | All copy is neutral and calm. |
| Nudges only when intensity threshold crossed | Pills appear only when content triggers the heuristic. |
| Pause banner same for both parents | Same text: "This conversation has been temporarily paused…" |
| Cool-off invisible to co-parent | No banner or report entry for the other parent. |
| Buffered messages hidden until release | Recipient in cool-off does not see new incoming messages until cool-off ends. |
