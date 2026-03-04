import { NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import {
  computeRecencyWeight,
  evaluateVowAlignment,
  type VowAlignmentLabel,
} from "@/lib/vow-alignment";

type RangeParam = "last_7" | "last_30" | "last_90" | "custom";

function parseRange(params: URLSearchParams): { from: Date; to: Date } {
  const today = new Date();
  const range = (params.get("range") as RangeParam | null) ?? "last_30";

  if (range === "custom") {
    const fromStr = params.get("from");
    const toStr = params.get("to");
    if (fromStr && toStr) {
      return { from: new Date(fromStr), to: new Date(toStr) };
    }
  }

  const to = today;
  const from = new Date(to);
  if (range === "last_7") {
    from.setDate(to.getDate() - 7);
  } else if (range === "last_90") {
    from.setDate(to.getDate() - 90);
  } else {
    from.setDate(to.getDate() - 30);
  }

  return { from, to };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const caseId = membership?.case_id as string | undefined;
    if (!caseId) {
      return NextResponse.json(
        { message: "No active case", alignment: null },
        { status: 200 }
      );
    }

    let vowId = searchParams.get("vowId");

    if (!vowId) {
      const { data: pinned } = await admin
        .from("vows")
        .select("id, content")
        .eq("case_id", caseId)
        .eq("user_id", user.id)
        .eq("is_pinned", true)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();

      if (!pinned) {
        return NextResponse.json(
          {
            range: null,
            vow: null,
            alignment: null,
            examples: {},
          },
          { status: 200 }
        );
      }

      vowId = pinned.id as string;
      searchParams.set("vowId", vowId);
    }

    const { data: vow } = await admin
      .from("vows")
      .select("id, content")
      .eq("id", vowId)
      .eq("case_id", caseId)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!vow) {
      return NextResponse.json(
        { message: "Vow not found", alignment: null },
        { status: 404 }
      );
    }

    const { from, to } = parseRange(searchParams);

    const { data: messages, error: msgError } = await supabase
      .from("messages")
      .select("id, original_content, created_at, direction, sender_id")
      .eq("case_id", caseId)
      .eq("sender_id", user.id)
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .order("created_at", { ascending: true });

    if (msgError) {
      console.error("VOW ALIGNMENT ERROR (messages query):", msgError);
      return NextResponse.json(
        { message: "Failed to load messages" },
        { status: 500 }
      );
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        {
          range: { from: from.toISOString(), to: to.toISOString() },
          vow: { id: vow.id, text: vow.content },
          alignment: null,
          examples: {},
        },
        { status: 200 }
      );
    }

    type MessageRow = {
      id: string;
      original_content: string;
      created_at: string;
    };

    const alignedMessages: (MessageRow & {
      score: number;
      label: VowAlignmentLabel;
      reasons: string[];
    })[] = [];

    let weightedSum = 0;
    let weightTotal = 0;

    const counts: Record<VowAlignmentLabel, number> = {
      aligned: 0,
      at_risk: 0,
      off_vow: 0,
    };

    const reasonCounts = new Map<string, number>();
    const trendByDate = new Map<
      string,
      { sum: number; count: number }
    >();

    for (const m of messages as MessageRow[]) {
      const result = evaluateVowAlignment({
        vowText: vow.content as string,
        messageText: m.original_content ?? "",
      });

      const weight = computeRecencyWeight(m.created_at, to);
      weightedSum += result.score0to1 * 100 * weight;
      weightTotal += weight;

      counts[result.label] += 1;

      for (const r of result.reasons) {
        reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
      }

      const day = m.created_at.slice(0, 10);
      const trend = trendByDate.get(day) ?? { sum: 0, count: 0 };
      trend.sum += result.score0to1 * 100;
      trend.count += 1;
      trendByDate.set(day, trend);

      alignedMessages.push({
        ...m,
        score: result.score0to1,
        label: result.label,
        reasons: result.reasons,
      });
    }

    const total = alignedMessages.length;

    const score_avg_0_to_100 =
      weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 10) / 10 : 0;

    const reasons_top = Array.from(reasonCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    const trend = Array.from(trendByDate.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, { sum, count }]) => ({
        date,
        score_0_to_100: Math.round((sum / count) * 10) / 10,
      }));

    const examples: {
      aligned?: any;
      at_risk?: any;
      off_vow?: any;
    } = {};

    const bestAligned = alignedMessages
      .filter((m) => m.label === "aligned")
      .sort((a, b) => b.score - a.score)[0];
    if (bestAligned) {
      examples.aligned = {
        message_id: bestAligned.id,
        snippet: (bestAligned.original_content || "").slice(0, 220),
        date: bestAligned.created_at,
        reasons: bestAligned.reasons,
      };
    }

    const mostOffVow = alignedMessages
      .filter((m) => m.label === "off_vow")
      .sort((a, b) => a.score - b.score)[0];
    if (mostOffVow) {
      examples.off_vow = {
        message_id: mostOffVow.id,
        snippet: (mostOffVow.original_content || "").slice(0, 220),
        date: mostOffVow.created_at,
        reasons: mostOffVow.reasons,
      };
    }

    const atRiskPool = alignedMessages.filter((m) => m.label === "at_risk");
    if (atRiskPool.length > 0) {
      const mid = atRiskPool[Math.floor(atRiskPool.length / 2)];
      examples.at_risk = {
        message_id: mid.id,
        snippet: (mid.original_content || "").slice(0, 220),
        date: mid.created_at,
        reasons: mid.reasons,
      };
    }

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      vow: { id: vow.id, text: vow.content },
      alignment: {
        score_avg_0_to_100,
        counts: {
          aligned: counts.aligned,
          at_risk: counts.at_risk,
          off_vow: counts.off_vow,
          total,
        },
        reasons_top,
        trend,
      },
      examples,
    });
  } catch (err) {
    console.error("VOW ALIGNMENT ERROR:", err);
    return NextResponse.json(
      { message: "Unexpected error" },
      { status: 500 }
    );
  }
}

