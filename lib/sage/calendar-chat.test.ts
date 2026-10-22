import assert from "node:assert/strict";
import { buildCalendarInitialValues, hasVisibleProposalCards } from "@/components/sage/proposal-helpers";
import { deriveOpenItems } from "@/lib/open-items";
import type { SageItem, SageProposal } from "@/components/sage/proposal-types";
import {
  answerCalendarQuestion,
  type CaseEvent,
  type KnownChild,
} from "@/lib/sage/calendar-chat";
import { routeChatIntent } from "@/lib/sage/chat-intent";
import type { ConversationContext } from "@/lib/sage/conversation-context";

const today = new Date("2026-10-21T18:00:00Z");
const timezone = "America/Denver";
const ashley: KnownChild = { id: "child-ashley", name: "Ashley" };
const avery: KnownChild = { id: "child-avery", name: "Avery" };
const ashleyAgain: KnownChild = { id: "child-ashley-2", name: "Ashley Morgan" };
const children = [ashley, avery];

const orthodontist: CaseEvent = {
  id: "event-ortho",
  title: "Ashley — Orthodontist Appointment",
  childId: ashley.id,
  start: "2026-10-22T21:30:00.000Z",
  description: "Location: Smile Orthodontics\nArrive 15 minutes early.",
  status: "confirmed",
  allDay: false,
  visibility: "family",
  createdBy: "parent-1",
};
const averyVisit: CaseEvent = {
  id: "event-avery",
  title: "Avery — Doctor Appointment",
  childId: avery.id,
  start: "2026-10-23T18:00:00.000Z",
  description: null,
  status: null,
  allDay: false,
  visibility: "family",
  createdBy: "parent-1",
};
const canceled: CaseEvent = {
  id: "event-canceled",
  title: "Ashley — Therapy Appointment",
  childId: ashley.id,
  start: "2026-10-24T16:00:00.000Z",
  description: null,
  status: "canceled",
  allDay: false,
  visibility: "parents_only",
  createdBy: "parent-1",
};
const privateOther: CaseEvent = {
  id: "event-private",
  title: "Private planning",
  childId: ashley.id,
  start: "2026-10-22T20:00:00.000Z",
  description: null,
  status: null,
  allDay: false,
  visibility: "private",
  createdBy: "parent-2",
};

function savedContext(): ConversationContext {
  return {
    thread_subject: "Orthodontist",
    event: {
      subject: "Orthodontist Appointment",
      child: "Ashley",
      date: "2026-10-22",
      time: "3:30 PM",
      eventId: orthodontist.id,
    },
    open_proposals: [],
  };
}

function item(childIds: string[]): SageItem {
  return {
    id: "item-1",
    item_type: "calendar_event",
    domain: "coordination",
    summary: "Add the appointment.",
    evidence_excerpt: "Ashley has an orthodontist appointment tomorrow at 3:30 PM.",
    urgency: "normal",
    action_required: true,
    child_ids: childIds,
    tool_input: { event_subject: "Orthodontist Appointment" },
    plan: null,
    status: "pending",
    created_at: "2026-10-21T18:00:00.000Z",
  };
}

const named = routeChatIntent({
  message: "Ashley has an orthodontist appointment tomorrow at 3:30 PM.",
  children,
  timezone,
  today,
});
const card = named.result.plan.proposals.find((p) => p.type === "calendar_update");
assert.ok(card);
assert.deepEqual(named.result.child_ids, [ashley.id]);
assert.equal(named.result.unresolved_children.length, 0);
assert.equal(card.title, "Ashley — Orthodontist Appointment");
assert.equal(card.category, "medical");
assert.equal(card.event_start, "15:30");
assert.equal(card.calendar_intent, "offer");
assert.equal(card.requires_approval, true);
assert.equal("executed" in card, false);
assert.equal(card.date, "2026-10-22");

const form = buildCalendarInitialValues(item(named.result.child_ids), card as SageProposal);
assert.equal(form.childId, ashley.id);
assert.equal(form.title, "Ashley — Orthodontist Appointment");
assert.equal(form.startTime, "15:30");
assert.equal(form.endTime, undefined);
assert.equal(form.eventType, "medical");
assert.equal(form.visibility, "family");
assert.equal(form.kidTitle, form.title);
assert.equal(form.allDay, undefined);

const ambiguous = routeChatIntent({
  message: "Ashley has an orthodontist appointment tomorrow at 3:30 PM.",
  children: [ashley, ashleyAgain],
  timezone,
  today,
});
assert.ok(ambiguous.result.plan.proposals.every((p) => p.type === "ask_clarification"));
assert.match(ambiguous.reply, /Which/);

const missing = routeChatIntent({
  message: "Ashley has therapy next Thursday.",
  children,
  timezone,
  today,
});
assert.ok(missing.result.plan.proposals.every((p) => p.type === "ask_clarification"));
assert.equal(missing.reply, "What time is Ashley's therapy appointment?");
assert.equal(missing.result.plan.proposals.some((p) => p.type === "calendar_update"), false);
assert.equal(missing.result.plan.proposals.some((p) => p.event_start === "09:00"), false);
assert.deepEqual(missing.result.child_ids, [ashley.id]);
assert.equal(missing.result.event_subject, "Therapy Appointment");
assert.equal(missing.result.resolved_dates[0]?.iso, "2026-10-22");
assert.equal(hasVisibleProposalCards(missing.result.plan.proposals), false);
assert.equal(
  deriveOpenItems([
    {
      id: "item-time",
      created_at: "2026-10-21T18:00:00Z",
      source_type: "chat",
      item_type: "calendar_event",
      action_required: false,
      plan: missing.result.plan,
    },
  ]).length,
  0
);

const bare = routeChatIntent({
  message: "Ashley needs to be at school at 6 tomorrow.",
  children,
  timezone,
  today,
});
assert.equal(bare.result.plan.proposals.some((p) => p.type === "calendar_update"), false);
assert.match(bare.reply, /What time/);
assert.equal(bare.result.plan.proposals.some((p) => p.event_start === "09:00"), false);

const completed = routeChatIntent({
  message: "3:30 PM",
  children,
  timezone,
  today,
  conversation: {
    thread_subject: "Therapy",
    event: {
      subject: "Therapy appointment",
      child: "Ashley",
      date: "2026-10-22",
      time: null,
    },
    open_proposals: [],
  },
});
const completedCard = completed.result.plan.proposals.find((p) => p.type === "calendar_update");
assert.ok(completedCard);
assert.equal(completedCard.event_start, "15:30");
assert.equal(completedCard.title, "Ashley — Therapy Appointment");
assert.equal(completedCard.category, "therapy");
assert.deepEqual(completed.result.child_ids, [ashley.id]);
assert.equal(completedCard.calendar_event_id, undefined);
assert.equal(completed.result.plan.proposals.filter((p) => p.type === "calendar_update").length, 1);
assert.equal(completedCard.requires_approval, true);
assert.equal("executed" in completedCard, false);
assert.equal(hasVisibleProposalCards(completed.result.plan.proposals), true);
assert.equal(
  deriveOpenItems([
    {
      id: "item-ready",
      created_at: "2026-10-21T18:05:00Z",
      source_type: "chat",
      action_required: true,
      plan: completed.result.plan,
    },
  ]).length,
  1
);
const therapyForm = buildCalendarInitialValues(item([ashley.id]), completedCard as SageProposal);
assert.equal(therapyForm.visibility, "parents_only");
assert.equal(therapyForm.kidTitle, undefined);
assert.equal(therapyForm.eventType, "therapy");

const located = routeChatIntent({
  message: "It's at Smile Orthodontics, and we need to arrive 15 minutes early.",
  children,
  events: [orthodontist, averyVisit],
  timezone,
  today,
  conversation: savedContext(),
});
const locatedCard = located.result.plan.proposals.find((p) => p.type === "calendar_update");
assert.ok(locatedCard);
assert.equal(locatedCard.calendar_intent, "update");
assert.equal(locatedCard.calendar_event_id, orthodontist.id);
assert.equal(locatedCard.event_start, "15:30");
assert.match(locatedCard.description ?? "", /Location: Smile Orthodontics/);
assert.match(locatedCard.description ?? "", /Arrive 15 minutes early/);
assert.doesNotMatch(locatedCard.description ?? "", /3:15|15:15/);
assert.equal(locatedCard.requires_approval, true);
assert.equal("executed" in locatedCard, false);
const locatedForm = buildCalendarInitialValues(item([ashley.id]), locatedCard as SageProposal);
assert.equal(locatedForm.eventId, orthodontist.id);
assert.equal(locatedForm.childId, ashley.id);
assert.equal(locatedForm.startTime, "15:30");
assert.match(locatedForm.description ?? "", /Smile Orthodontics/);

const moved = routeChatIntent({
  message: "Actually, it's at 4 PM.",
  children,
  events: [orthodontist],
  timezone,
  today,
  conversation: savedContext(),
});
const movedCard = moved.result.plan.proposals.find((p) => p.type === "calendar_update");
assert.ok(movedCard);
assert.equal(movedCard.calendar_event_id, orthodontist.id);
assert.equal(movedCard.event_start, "16:00");
assert.match(movedCard.description ?? "", /Smile Orthodontics/);

const relocated = routeChatIntent({
  message: "Change the location to the school.",
  children,
  events: [orthodontist],
  timezone,
  today,
  conversation: savedContext(),
});
const relocatedCard = relocated.result.plan.proposals.find((p) => p.type === "calendar_update");
assert.ok(relocatedCard);
assert.equal(relocatedCard.event_start, "15:30");
assert.match(relocatedCard.description ?? "", /Location: school/);
assert.match(relocatedCard.description ?? "", /Arrive 15 minutes early/);

const cancel = routeChatIntent({
  message: "That appointment was canceled.",
  children,
  events: [orthodontist],
  timezone,
  today,
  conversation: savedContext(),
});
const cancelCard = cancel.result.plan.proposals.find((p) => p.type === "calendar_update");
assert.ok(cancelCard);
assert.equal(cancelCard.calendar_event_id, orthodontist.id);
assert.equal(cancelCard.event_status, "canceled");
assert.equal(cancelCard.event_start, "15:30");
const cancelForm = buildCalendarInitialValues(item([ashley.id]), cancelCard as SageProposal);
assert.equal(cancelForm.eventStatus, "canceled");
assert.equal(cancelForm.eventId, orthodontist.id);

const second: CaseEvent = {
  ...orthodontist,
  id: "event-ortho-2",
  title: "Ashley — Orthodontist Appointment",
  start: "2026-10-22T22:00:00.000Z",
};
const which = routeChatIntent({
  message: "It's at Smile Orthodontics.",
  children,
  events: [orthodontist, second],
  timezone,
  today,
  conversation: {
    ...savedContext(),
    event: { ...savedContext().event, eventId: null },
  },
});
assert.ok(which.result.plan.proposals.every((p) => p.type === "ask_clarification"));
assert.match(which.reply, /Which appointment/);

const allDay = routeChatIntent({
  message: "Ashley has a school day all day tomorrow.",
  children,
  timezone,
  today,
});
const allDayCard = allDay.result.plan.proposals.find((p) => p.type === "calendar_update");
assert.ok(allDayCard);
assert.equal(allDayCard.all_day, true);
assert.equal(allDayCard.event_start, null);

function ask(message: string, events: CaseEvent[] = [orthodontist, averyVisit, canceled, privateOther]) {
  return routeChatIntent({
    message,
    children,
    events,
    viewerId: "parent-1",
    timezone,
    today,
  });
}

const upcoming = ask("What appointments does Ashley have coming up?");
assert.equal(upcoming.result.plan.proposals.length, 0);
assert.equal(upcoming.handled, true);
assert.match(upcoming.reply, /Orthodontist Appointment/);
assert.doesNotMatch(upcoming.reply, /Avery/);
assert.doesNotMatch(upcoming.reply, /Therapy/);
assert.doesNotMatch(upcoming.reply, /Private planning/);

const tomorrow = ask("What is on the calendar tomorrow?");
assert.equal(tomorrow.result.plan.proposals.length, 0);
assert.match(tomorrow.reply, /Orthodontist/);
assert.doesNotMatch(tomorrow.reply, /Private planning/);

const next = ask("When is Ashley's next appointment?");
assert.match(next.reply, /next appointment/i);
assert.match(next.reply, /Orthodontist/);
assert.doesNotMatch(next.reply, /Doctor/);

const month = ask("Show me Avery's appointments this month.");
assert.match(month.reply, /Doctor/);
assert.doesNotMatch(month.reply, /Orthodontist/);

const friday = ask("Do we have anything scheduled Friday?");
assert.match(friday.reply, /Doctor/);
assert.equal(friday.result.plan.proposals.length, 0);

const none = ask("What appointments does Ashley have coming up?", []);
assert.match(none.reply, /doesn't have a matching appointment/);
assert.equal(none.result.plan.proposals.length, 0);

const canceledOnly = ask("What canceled appointments does Ashley have?");
assert.match(canceledOnly.reply, /Therapy/);

const direct = answerCalendarQuestion({
  message: "What appointments does Ashley have coming up?",
  children,
  events: [orthodontist, averyVisit, canceled, privateOther],
  viewerId: "parent-1",
  today,
  timezone,
});
assert.ok(direct);
assert.match(direct, /Smile Orthodontics/);
assert.doesNotMatch(direct, /Avery/);
