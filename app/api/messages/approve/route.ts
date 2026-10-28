import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { estimateIntensity, type IntensityResult } from "@/lib/sage/intensity";
import { ServerClient, Message, Header } from "postmark";
import { waitUntil } from "@vercel/functions";
import { parentDirectory } from "@/lib/messages/case-parents";
import { receivingAddress, resolveReceivingParent } from "@/lib/messages/receiving-parent";
import { announceIncomingMessage, announceSavedMessage } from "@/lib/messages/deliver-parent-message";
import { reviewGate, reviewGateFailure } from "@/lib/messages/review-receipt";
import {
  SEND_ATTEMPT_CONFLICT_MESSAGE,
  decideSendAttempt,
  insertOutgoingMessage,
} from "@/lib/messages/send-attempt-store";
import { validSendAttemptId } from "@/lib/messages/send-attempt";

/**
 * Approve draft and send: insert message (outgoing). Checks cool-off and structured pause.
 * Writes intensity_score/intensity_flag, delivery_status, delivered_at.
 * The final text needs proof of the shared outbound review (or an explicit acknowledgement).
 * Each approval carries a send-attempt id. A retry of that approval returns the saved message,
 * and two separate approvals of identical text are two messages.
 * The receiving parent is announced once.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const {
      case_id,
      conversation_id,
      original_content,
      ai_rewritten_content,
      is_emergency,
      emergency_type,
      emergency_note,
      review_receipt,
      review_unavailable_ack,
      edit_unreviewed_ack,
      send_attempt_id,
    } = body as {
      case_id?: string;
      conversation_id?: string | null;
      original_content?: string;
      ai_rewritten_content?: string;
      is_emergency?: boolean;
      emergency_type?: string | null;
      emergency_note?: string | null;
      review_receipt?: string | null;
      review_unavailable_ack?: boolean;
      edit_unreviewed_ack?: boolean;
      send_attempt_id?: string | null;
    };
    if (!case_id || !original_content || !ai_rewritten_content) {
      return NextResponse.json(
        { message: "Missing case_id, original_content, or ai_rewritten_content" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: membership } = await admin
      .from("case_members")
      .select("id")
      .eq("case_id", case_id)
      .eq("user_id", user.id)
      .limit(1);
    if (!membership || membership.length === 0) {
      return NextResponse.json({ message: "You are not a member of this case." }, { status: 403 });
    }
    if (conversation_id) {
      const { data: owned } = await admin
        .from("conversations")
        .select("id")
        .eq("id", conversation_id)
        .eq("case_id", case_id)
        .maybeSingle();
      if (!owned) {
        return NextResponse.json({ message: "That conversation is not on this case." }, { status: 403 });
      }
    }

    // Each approval is one send attempt. A retry of that attempt returns the saved message.
    const attemptId = validSendAttemptId(send_attempt_id);
    if (!attemptId) {
      return NextResponse.json(
        { message: "This send is missing its attempt id. Refresh the page and send again.", code: "send_attempt_required" },
        { status: 400 }
      );
    }
    const attempt = await decideSendAttempt(admin, {
      senderId: user.id,
      attemptId,
      text: ai_rewritten_content,
    });
    if (attempt.kind === "conflict") {
      return NextResponse.json(
        { message: SEND_ATTEMPT_CONFLICT_MESSAGE, code: "send_attempt_conflict" },
        { status: 409 }
      );
    }
    if (attempt.kind === "duplicate") {
      // A retry of a saved send. Announcing again is safe, and it covers an attempt that stopped early.
      try {
        await announceSavedMessage(admin, {
          caseId: case_id,
          senderId: user.id,
          messageId: attempt.messageId,
          conversationId: attempt.conversationId,
          runInBackground: (task) => waitUntil(task),
        });
      } catch (error) {
        console.error("[messages/approve] announce on retry:", error);
      }
      return NextResponse.json({ ok: true, message_id: attempt.messageId, duplicate: true });
    }
    const attemptStored = attempt.stored;
    if (!attemptStored) {
      console.warn(`[messages/approve] send_attempt_id column unavailable; idempotency off user_id=${user.id}`);
    }

    // Every outgoing co-parent message is reviewed first. The receipt covers the draft and the
    // Sage suggestion. Any other final text needs a new review or an explicit acknowledgement.
    const gate = reviewGate({
      receipt: review_receipt,
      unavailableAcknowledged: review_unavailable_ack === true,
      editUnreviewedAcknowledged: edit_unreviewed_ack === true,
      userId: user.id,
      text: ai_rewritten_content,
    });
    if (!gate.ok) {
      return NextResponse.json(reviewGateFailure(gate.reason), { status: 409 });
    }
    if (gate.status === "unavailable_acknowledged") {
      console.warn(`[messages/approve] sent after review was unavailable user_id=${user.id}`);
    }
    if (gate.status === "edited_unreviewed_acknowledged") {
      console.warn(`[messages/approve] sent edited text without another review user_id=${user.id}`);
    }

    const allowEmergency =
      typeof is_emergency === "boolean" &&
      is_emergency &&
      typeof emergency_type === "string" &&
      ["medical", "safety", "logistics"].includes(emergency_type) &&
      typeof emergency_note === "string" &&
      emergency_note.trim().length >= 1;

    // Cool-off and structured pauses are bypassed only for valid emergency messages.
    if (!allowEmergency) {
      const inCoolOff = await admin
        .from("cool_off")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .gt("ends_at", new Date().toISOString())
        .maybeSingle();
      if (inCoolOff.data) {
        return NextResponse.json(
          {
            message:
              "Sending is paused while you take a break. It will be available again when your break ends.",
          },
          { status: 403 }
        );
      }

      if (conversation_id) {
        const now = new Date().toISOString();
        const { data: pause } = await admin
          .from("structured_pauses")
          .select("id, mode, created_by")
          .eq("conversation_id", conversation_id)
          .gt("ends_at", now)
          .order("ends_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (pause) {
          const blocked =
            pause.mode === "auto" ||
            pause.mode === "user_mutual" ||
            (pause.mode === "user_unilateral" && pause.created_by === user.id);
          if (blocked) {
            return NextResponse.json(
              {
                message:
                  "This conversation is paused. It will reopen at the scheduled time.",
              },
              { status: 403 }
            );
          }
        }
      }
    }

    let emergencyAllowed = allowEmergency;
    if (allowEmergency) {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await admin
        .from("messages")
        .select("id")
        .eq("sender_id", user.id)
        .eq("is_emergency", true)
        .gte("created_at", weekAgo);
      if ((recent?.length ?? 0) >= 3) {
        emergencyAllowed = false;
      }
    }

    const contentForIntensity = ai_rewritten_content ?? original_content;
    const intensityResult: IntensityResult = estimateIntensity(contentForIntensity);
    const { score, flag, severe } = intensityResult;

    const insertPayload: Record<string, unknown> = {
      case_id,
      conversation_id: conversation_id ?? null,
      direction: "outgoing",
      sender_id: user.id,
      original_content,
      ai_rewritten_content,
      ai_rewritten: ai_rewritten_content.trim() !== original_content.trim(),
      current_status: "sent",
      delivery_status: "sent",
      delivered_at: null,
      intensity_score: score,
      intensity_flag: flag,
      is_emergency: emergencyAllowed ?? false,
      emergency_type: emergencyAllowed ? emergency_type : null,
      emergency_note: emergencyAllowed ? emergency_note?.trim() ?? null : null,
    };

    const saved = await insertOutgoingMessage(admin, {
      row: insertPayload,
      senderId: user.id,
      attemptId,
      stored: attemptStored,
      text: ai_rewritten_content,
    });
    if (!saved.ok) {
      return NextResponse.json({ message: saved.message }, { status: 500 });
    }
    if (saved.duplicate) {
      // A parallel request of the same attempt saved first. That message is the send.
      return NextResponse.json({ ok: true, message_id: saved.messageId, duplicate: true });
    }
    const message = { id: saved.messageId };

    if (conversation_id) {
      const { data: conv } = await admin
        .from("conversations")
        .select("subject, coparent_email, email_thread_id")
        .eq("id", conversation_id)
        .single();
      const { data: caseRow } = await admin
        .from("cases")
        .select("ingest_email")
        .eq("id", case_id)
        .single();
      const ingestEmail = (caseRow as { ingest_email?: string | null } | null)?.ingest_email ?? null;
      const storedCoparentEmail = (conv as { coparent_email?: string | null; subject?: string; email_thread_id?: string | null } | null)?.coparent_email ?? null;

      // The receiving parent is the other parent on the case. The conversation keeps one
      // co-parent address, which can be the sender's own, so the email goes to the receiver's.
      const directory = await parentDirectory(admin, case_id, user.id);
      const receiverCheck = resolveReceivingParent({
        senderId: user.id,
        recipientEmails: [storedCoparentEmail],
        parents: directory.parents,
      });
      const receiver = receiverCheck.ok
        ? directory.parents.find((parent) => parent.userId === receiverCheck.userId) ?? null
        : null;
      const coparentEmail = receivingAddress({
        conversationEmail: storedCoparentEmail,
        receiver,
        sender: directory.parents.find((parent) => parent.userId === user.id) ?? null,
      });
      const convSubject = (conv as { subject?: string } | null)?.subject ?? "";
      const emailThreadId = (conv as { email_thread_id?: string | null } | null)?.email_thread_id ?? null;

      if (coparentEmail) {
        const recorded = await admin
          .from("messages")
          .update({ recipient_email: coparentEmail })
          .eq("id", (message as { id: string }).id);
        if (recorded.error && !/recipient_email/.test(recorded.error.message)) {
          console.error("[messages/approve] recipient", recorded.error.message);
        }
      }

      if (coparentEmail && ingestEmail) {
        const token = process.env.POSTMARK_SERVER_TOKEN;
        if (token) {
          const messageId = `<msg-${(message as { id: string }).id}@myvow.in>`;
          const textBody = (ai_rewritten_content ?? original_content ?? "").trim();
          const subject = emailThreadId ? `Re: ${convSubject}` : convSubject;
          const headers: { Name: string; Value: string }[] = [
            { Name: "Message-ID", Value: messageId },
          ];
          if (emailThreadId) {
            headers.push({ Name: "In-Reply-To", Value: emailThreadId });
            headers.push({ Name: "References", Value: emailThreadId });
          }
          try {
            const client = new ServerClient(token);
            const emailMessage = new Message(
              ingestEmail,
              subject,
              undefined,
              textBody,
              coparentEmail,
              undefined,
              undefined,
              ingestEmail,
              undefined,
              undefined,
              undefined,
              headers.map((h) => new Header(h.Name, h.Value)),
              undefined,
              undefined
            );
            await client.sendEmail(emailMessage);
            await admin
              .from("messages")
              .update({
                email_message_id: messageId,
                delivery_status: "email_accepted",
                delivered_at: null,
              })
              .eq("id", (message as { id: string }).id);
            if (!emailThreadId) {
              await admin
                .from("conversations")
                .update({ email_thread_id: messageId })
                .eq("id", conversation_id);
            }
          } catch (err) {
            console.error("[messages/approve] Postmark send failed:", err);
          }
        }
      }

      if (receiverCheck.ok) {
        try {
          await announceIncomingMessage(admin, {
            caseId: case_id,
            conversationId: conversation_id,
            messageId: (message as { id: string }).id,
            recipientUserId: receiverCheck.userId,
            senderName: directory.senderName,
            runInBackground: (task) => waitUntil(task),
          });
        } catch (error) {
          // The message is saved. A retry of this attempt announces it again.
          console.error("[messages/approve] announce:", error);
        }
      } else {
        console.error(`[messages/approve] no receiving parent: ${receiverCheck.error}`);
      }

      const now = new Date();
      const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
      const sixtyMinAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const { data: existingAuto } = await admin
        .from("structured_pauses")
        .select("id")
        .eq("conversation_id", conversation_id)
        .eq("mode", "auto")
        .gt("ends_at", now.toISOString())
        .maybeSingle();
      if (!existingAuto) {
        const { data: recent } = await admin
          .from("messages")
          .select("id, created_at")
          .eq("conversation_id", conversation_id)
          .eq("intensity_flag", true)
          .gte("created_at", sixtyMinAgo);
        const inLast10 = (recent ?? []).filter((m) => m.created_at >= tenMinAgo).length;
        const inLast60 = recent?.length ?? 0;
        const shouldAutoPause =
          severe || inLast10 >= 3 || inLast60 >= 5;
        if (shouldAutoPause) {
          const endsAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
          await admin.from("structured_pauses").insert({
            conversation_id,
            created_by: null,
            mode: "auto",
            ends_at: endsAt.toISOString(),
          });
        }
      }
    }

    return NextResponse.json({ ok: true, message_id: message.id });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Send failed" },
      { status: 500 }
    );
  }
}
