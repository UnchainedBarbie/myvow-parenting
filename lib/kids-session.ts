import type { NextRequest } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

type KidSession = {
  kid_id: string;
  child: Record<string, unknown>;
};

export async function getKidSession(request: NextRequest): Promise<KidSession | null> {
  const token = request.cookies.get("kid_session_token")?.value;
  if (!token) {
    return null;
  }

  const admin = getServiceRoleClient();

  // Look up session by token
  const { data: session, error: sessionError } = await admin
    .from("kid_sessions")
    .select("id, kid_id, expires_at")
    .eq("session_token", token)
    .maybeSingle();

  if (sessionError || !session) {
    return null;
  }

  const expiresAt = session.expires_at as string | null | undefined;
  if (!expiresAt || new Date(expiresAt) <= new Date()) {
    return null;
  }

  // Load child row
  const { data: child, error: childError } = await admin
    .from("children")
    .select("*")
    .eq("id", session.kid_id)
    .maybeSingle();

  if (childError || !child) {
    return null;
  }

  // Best-effort last_active_at update; ignore errors
  void admin
    .from("kid_sessions")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", session.id);

  return {
    kid_id: session.kid_id as string,
    child: child as Record<string, unknown>,
  };
}

