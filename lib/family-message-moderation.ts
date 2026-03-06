const SYSTEM_PROMPT = `You are a child safety moderator for a family messaging app 
where children and parents communicate. Your job is to protect 
children from harmful content.

For PARENT messages: Apply STRICT moderation. Block any message 
that contains: conflict about the other parent, legal threats, 
guilt-tripping children, adult conflict, inappropriate content, 
manipulation, emotional pressure, or anything that could harm 
a child emotionally or psychologically.

For KID messages: Apply LIGHT moderation. Block only clearly 
harmful content: self-harm references, abuse disclosures 
needing escalation, or extremely inappropriate content.

Respond with JSON only: { "approved": boolean, "reason": string }`;

export type FamilyModerationResult = {
  approved: boolean;
  reason?: string;
};

export async function moderateFamilyMessage(
  content: string,
  senderType: "parent" | "kid"
): Promise<FamilyModerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Fail-closed for parents; fail-open for kids when Anthropic is unavailable.
  if (!apiKey) {
    if (senderType === "parent") {
      return {
        approved: false,
        reason: "Anthropic API key not configured; blocking parent message by default.",
      };
    }
    return {
      approved: true,
      reason: "Anthropic API unavailable; allowing kid message by default.",
    };
  }

  try {
    const payload = {
      senderType,
      content,
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: JSON.stringify(payload),
          },
        ],
      }),
    });

    if (!res.ok) {
      if (senderType === "parent") {
        return {
          approved: false,
          reason: `Moderation API error: ${res.status} ${res.statusText}`,
        };
      }
      return {
        approved: true,
        reason: `Moderation API error (kid message allowed): ${res.status} ${res.statusText}`,
      };
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";

    if (!text.trim()) {
      if (senderType === "parent") {
        return {
          approved: false,
          reason: "Empty moderation response; blocking parent message.",
        };
      }
      return {
        approved: true,
        reason: "Empty moderation response; allowing kid message.",
      };
    }

    let parsed: { approved?: unknown; reason?: unknown };
    try {
      const cleaned = text.replace(/^```json?\s*|\s*```$/g, "").trim();
      parsed = JSON.parse(cleaned) as { approved?: unknown; reason?: unknown };
    } catch {
      if (senderType === "parent") {
        return {
          approved: false,
          reason: "Invalid moderation JSON; blocking parent message.",
        };
      }
      return {
        approved: true,
        reason: "Invalid moderation JSON; allowing kid message.",
      };
    }

    const approved =
      typeof parsed.approved === "boolean" ? parsed.approved : false;
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim().length > 0
        ? parsed.reason.trim()
        : undefined;

    if (senderType === "parent" && !approved && !reason) {
      return {
        approved: false,
        reason: "Blocked without specific reason from moderator.",
      };
    }

    if (senderType === "kid" && !reason) {
      return {
        approved,
        reason: approved
          ? "Kid message approved."
          : "Kid message blocked by moderator.",
      };
    }

    return { approved, reason };
  } catch (e) {
    if (senderType === "parent") {
      return {
        approved: false,
        reason:
          e instanceof Error
            ? `Moderation error: ${e.message}`
            : "Moderation error; blocking parent message.",
      };
    }
    return {
      approved: true,
      reason:
        e instanceof Error
          ? `Moderation error (kid message allowed): ${e.message}`
          : "Moderation error; allowing kid message.",
    };
  }
}

