import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

const INBOUND_DOMAIN = "in.myvowparenting.com";

/** Generate a URL-safe random token (e.g. for uploads+TOKEN@in.myvowparenting.com). */
function generateToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 24; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

/**
 * GET /api/inbound/token — return the authenticated user's inbound email token and address.
 * Creates a token if none exists (service role insert).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getServiceRoleClient();
  let { data: row } = await admin
    .from("user_inbound_tokens")
    .select("token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row) {
    let token = generateToken();
    let attempts = 0;
    while (attempts < 5) {
      const { error } = await admin.from("user_inbound_tokens").insert({
        user_id: user.id,
        token,
      });
      if (!error) break;
      if ((error as { code?: string }).code === "23505") {
        token = generateToken();
        attempts++;
        continue;
      }
      return NextResponse.json({ error: "Failed to create token" }, { status: 500 });
    }
    row = { token };
  }

  const token = (row as { token: string }).token;
  const email_address = `uploads+${token}@${INBOUND_DOMAIN}`;
  return NextResponse.json({ token, email_address });
}
