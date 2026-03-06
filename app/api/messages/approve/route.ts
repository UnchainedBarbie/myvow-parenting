import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { estimateIntensity, type IntensityResult } from "@/lib/sage/intensity";
import { ServerClient, Message, Header } from "postmark";

/**
 * Approve draft and send: insert message (outgoing). Checks cool-off and structured pause.
 * Writes intensity_score/intensity_flag, delivery_status, delivered_at.
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
    } = body as {
      case_id?: string;
      conversation_id?: string | null;
      original_content?: string;
      ai_rewritten_content?: string;
      is_emergency?: boolean;
      emergency_type?: string | null;
      emergency_note?: string | null;
    };
    if (!case_id || !original_content || !ai_rewritten_content) {
      return NextResponse.json(
        { message: "Missing case_id, original_content, or ai_rewritten_content" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

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
      ai_rewritten: true,
      current_status: "sent",
      delivery_status: "delivered",
      delivered_at: new Date().toISOString(),
      intensity_score: score,
      intensity_flag: flag,
      is_emergency: emergencyAllowed ?? false,
      emergency_type: emergencyAllowed ? emergency_type : null,
      emergency_note: emergencyAllowed ? emergency_note?.trim() ?? null : null,
    };

    const { data: message, error: msgError } = await admin
      .from("messages")
      .insert(insertPayload)
      .select("id")
      .single();
    if (msgError) {
      return NextResponse.json(
        { message: msgError.message },
        { status: 500 }
      );
    }

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
      const coparentEmail = (conv as { coparent_email?: string | null; subject?: string; email_thread_id?: string | null } | null)?.coparent_email ?? null;
      const convSubject = (conv as { subject?: string } | null)?.subject ?? "";
      const emailThreadId = (conv as { email_thread_id?: string | null } | null)?.email_thread_id ?? null;

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
              .update({ email_message_id: messageId })
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
