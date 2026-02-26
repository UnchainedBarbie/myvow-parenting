import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Creates a row in public.users after Supabase Auth signup.
 * Call this from the client after auth.signUp(); id must match auth.users.id.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, email, full_name } = body as {
      id: string;
      email: string;
      full_name: string;
    };
    if (!id || !email || !full_name) {
      return NextResponse.json(
        { message: "Missing id, email, or full_name" },
        { status: 400 }
      );
    }
    const supabase = getServiceRoleClient();
    const { error } = await supabase.from("users").insert({
      id,
      email,
      full_name,
    });
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { message: "User profile already exists" },
          { status: 200 }
        );
      }
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { message: "Invalid request" },
      { status: 400 }
    );
  }
}
