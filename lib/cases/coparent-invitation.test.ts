import assert from "node:assert/strict";
import { knownCoparentsFromRows } from "@/lib/sage/known-coparents";
import {
  acceptanceUpdate,
  classifyInvite,
  createInvitationToken,
  decideAcceptance,
  hashInvitationToken,
  invitationDeliveryFields,
  invitationEmailText,
  inviteSlotAction,
  maskEmail,
  presentCoparent,
  publicDeliveryError,
  safeInviteNext,
  type InviteRow,
} from "@/lib/cases/coparent-invitation";

const now = new Date("2026-10-21T18:00:00Z");
const future = new Date(now.getTime() + 60_000).toISOString();
const past = new Date(now.getTime() - 60_000).toISOString();

function row(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: "member-pending",
    caseId: "case-1",
    userId: null,
    status: "invited",
    email: "riley@example.com",
    tokenHash: hashInvitationToken("invite-token-value"),
    expiresAt: future,
    ...overrides,
  };
}

const created = createInvitationToken(now);
assert.notEqual(created.token, created.tokenHash);
assert.equal(created.tokenHash, hashInvitationToken(created.token));
assert.equal(created.tokenHash.length, 64);

const message = invitationEmailText({
  inviterName: "Alex",
  link: "https://app.example.com/invite?token=invite-token-value",
});
assert.match(message.text, /invite-token-value/);
assert.match(message.subject, /invited/i);
assert.equal(maskEmail("Riley@example.com"), "r***@example.com");

const leaked = publicDeliveryError(
  "Provider rejected https://app.example.com/invite?token=invite-token-value"
);
assert.doesNotMatch(leaked, /invite-token-value/);
assert.doesNotMatch(leaked, /https:/);

assert.equal(safeInviteNext("/invite?token=abc"), "/invite?token=abc");
assert.equal(safeInviteNext("https://evil.example/invite?token=abc"), null);
assert.equal(safeInviteNext("/dashboard"), null);

const owner = { id: "member-owner", userId: "owner-1", role: "parent" };
assert.deepEqual(inviteSlotAction([owner], "owner-1"), { action: "insert" });
assert.deepEqual(
  inviteSlotAction([owner, { id: "member-pending", userId: null, role: "parent" }], "owner-1"),
  { action: "update", memberId: "member-pending" }
);
assert.equal(
  inviteSlotAction(
    [owner, { id: "member-active", userId: "parent-2", role: "parent" }],
    "owner-1"
  ).action,
  "reject"
);
assert.deepEqual(
  inviteSlotAction([owner, { id: "child", userId: null, role: null }], "owner-1"),
  { action: "insert" }
);

const firstSend = invitationDeliveryFields({
  previousSentAt: null,
  now,
  mail: { accepted: true },
  tokenHash: created.tokenHash,
  expiresAt: created.expiresAt,
});
assert.equal(firstSend.emailSent, true);
assert.equal(firstSend.error, null);
assert.equal(firstSend.fields.invitation_sent_at, now.toISOString());
assert.equal("user_id" in firstSend.fields, false);
assert.equal("external_email" in firstSend.fields, false);

const notConfigured = invitationDeliveryFields({
  previousSentAt: null,
  now,
  mail: { accepted: false, message: "The invitation was not emailed because outbound email is not configured on the server." },
  tokenHash: "hash-config",
  expiresAt: future,
});
assert.equal(notConfigured.emailSent, false);
assert.equal(notConfigured.fields.invitation_sent_at, null);
assert.match(notConfigured.error ?? "", /not configured on the server/);
assert.doesNotMatch(notConfigured.error ?? "", /delivered/i);

const failedSend = invitationDeliveryFields({
  previousSentAt: null,
  now,
  mail: { accepted: false, message: "Mailbox rejected the invitation." },
  tokenHash: "hash-1",
  expiresAt: future,
});
assert.equal(failedSend.emailSent, false);
assert.equal(failedSend.fields.invitation_sent_at, null);
assert.match(failedSend.error ?? "", /Mailbox rejected/);

const failedResend = invitationDeliveryFields({
  previousSentAt: "2026-10-01T00:00:00.000Z",
  now,
  mail: { accepted: false, message: "Mailbox rejected the invitation." },
  tokenHash: "hash-2",
  expiresAt: future,
});
assert.equal(failedResend.fields.invitation_sent_at, "2026-10-01T00:00:00.000Z");
assert.equal(failedResend.fields.invitation_token_hash, "hash-2");
assert.notEqual(failedResend.fields.invitation_token_hash, "hash-1");

const resent = invitationDeliveryFields({
  previousSentAt: "2026-10-01T00:00:00.000Z",
  now,
  mail: { accepted: true },
  tokenHash: "hash-3",
  expiresAt: future,
});
assert.equal(resent.emailSent, true);
assert.equal(resent.fields.invitation_sent_at, now.toISOString());
assert.equal(resent.fields.invitation_last_error, null);

assert.equal(classifyInvite(null, now), "invalid");
assert.equal(classifyInvite(row({ tokenHash: null }), now), "invalid");
assert.equal(classifyInvite(row({ expiresAt: past }), now), "expired");
assert.equal(classifyInvite(row({ userId: "parent-2", status: "connected" }), now), "used");
assert.equal(classifyInvite(row(), now), "valid");

const noAccount = decideAcceptance({
  row: row(),
  now,
  authUserId: "new-user",
  authEmail: "Riley@example.com",
  existingCaseIds: [],
});
assert.equal(noAccount.ok, true);

const existingAccount = decideAcceptance({
  row: row(),
  now,
  authUserId: "existing-user",
  authEmail: "riley@example.com",
  existingCaseIds: [],
});
assert.equal(existingAccount.ok, true);
if (existingAccount.ok) {
  const patch = acceptanceUpdate(existingAccount.memberId ? "existing-user" : "existing-user");
  assert.equal(patch.user_id, "existing-user");
  assert.equal(patch.invitation_status, "connected");
  assert.equal(patch.invitation_token_hash, null);
  assert.equal("conversation_id" in patch, false);
  assert.equal("messages" in patch, false);
}

const expired = decideAcceptance({
  row: row({ expiresAt: past }),
  now,
  authUserId: "existing-user",
  authEmail: "riley@example.com",
  existingCaseIds: [],
});
assert.equal(expired.ok, false);
if (!expired.ok) assert.match(expired.error, /expired/i);

const reused = decideAcceptance({
  row: row({ userId: "existing-user", status: "connected" }),
  now,
  authUserId: "existing-user",
  authEmail: "riley@example.com",
  existingCaseIds: [],
});
assert.equal(reused.ok, false);
if (!reused.ok) assert.match(reused.error, /already been used/i);

const invalid = decideAcceptance({
  row: null,
  now,
  authUserId: "existing-user",
  authEmail: "riley@example.com",
  existingCaseIds: [],
});
assert.equal(invalid.ok, false);
if (!invalid.ok) assert.match(invalid.error, /not valid/i);

const wrongAccount = decideAcceptance({
  row: row(),
  now,
  authUserId: "other-user",
  authEmail: "someoneelse@example.com",
  existingCaseIds: [],
});
assert.equal(wrongAccount.ok, false);
if (!wrongAccount.ok) {
  assert.equal(wrongAccount.status, 403);
  assert.doesNotMatch(wrongAccount.error, /riley@example.com/i);
}

const otherFamily = decideAcceptance({
  row: row(),
  now,
  authUserId: "existing-user",
  authEmail: "riley@example.com",
  existingCaseIds: ["case-other"],
});
assert.equal(otherFamily.ok, false);
if (!otherFamily.ok) assert.match(otherFamily.error, /another family/i);

const sameFamily = decideAcceptance({
  row: row(),
  now,
  authUserId: "owner-1",
  authEmail: "riley@example.com",
  existingCaseIds: ["case-1"],
});
assert.equal(sameFamily.ok, false);
if (!sameFamily.ok) assert.match(sameFamily.error, /already a member/i);

const pendingProfile = presentCoparent({
  currentUserId: "owner-1",
  members: [
    {
      id: "member-owner",
      userId: "owner-1",
      displayName: "Alex",
      externalEmail: "alex@example.com",
      status: "connected",
      sentAt: null,
      lastError: null,
    },
    {
      id: "member-pending",
      userId: null,
      displayName: "Riley",
      externalEmail: "riley@example.com",
      status: "invited",
      sentAt: "2026-10-21T18:00:00.000Z",
      lastError: null,
    },
  ],
  users: [],
  addresses: [{ caseMemberId: "member-pending", email: "riley@example.com", isReply: true }],
});
assert.equal(pendingProfile.status, "invited");
assert.equal(pendingProfile.email, "riley@example.com");
assert.equal(pendingProfile.name, "Riley");
assert.equal(pendingProfile.invitationSentAt, "2026-10-21T18:00:00.000Z");

const activeProfile = presentCoparent({
  currentUserId: "owner-1",
  members: [
    {
      id: "member-owner",
      userId: "owner-1",
      displayName: "Alex",
      externalEmail: null,
      status: "connected",
      sentAt: null,
      lastError: null,
    },
    {
      id: "member-active",
      userId: "parent-2",
      displayName: null,
      externalEmail: null,
      status: "connected",
      sentAt: null,
      lastError: "old error",
    },
  ],
  users: [{ id: "parent-2", fullName: "Riley", email: "riley@example.com" }],
  addresses: [{ caseMemberId: "member-active", email: "riley@example.com", isReply: true }],
});
assert.equal(activeProfile.status, "connected");
assert.equal(activeProfile.email, "riley@example.com");
assert.equal(activeProfile.invitationError, null);

const beforeAcceptance = knownCoparentsFromRows(
  [
    { id: "member-owner", user_id: "owner-1", display_name: "Alex" },
    {
      id: "member-pending",
      user_id: null,
      display_name: "Riley",
      external_email: "riley@example.com",
      invitation_status: "invited",
    },
  ],
  [],
  [{ case_member_id: "member-pending", email: "riley@example.com", is_reply: true }],
  "owner-1"
);
assert.deepEqual(beforeAcceptance, [{ name: "Riley", email: "riley@example.com" }]);

console.log("coparent invitation tests passed");
