import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Remove the current user's profile photo.
 *
 * - Deletes the avatar file from the "avatars" bucket (best-effort).
 * - Sets users.profile_image to null.
 */
export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    // Best-effort delete: try common extensions; ignore errors.
    const basePath = `users/${user.id}/profile`;
    const candidates = [
      `${basePath}.jpg`,
      `${basePath}.jpeg`,
      `${basePath}.png`,
      `${basePath}.webp`,
    ];

    await admin.storage.from("avatars").remove(candidates);

    const { error: updateError } = await admin
      .from("users")
      .update({ profile_image: null })
      .eq("id", user.id);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message ?? "Failed to update profile" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to remove photo" },
      { status: 500 }
    );
  }
}

