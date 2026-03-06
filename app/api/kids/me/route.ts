import { NextRequest, NextResponse } from "next/server";
import { getKidSession } from "@/lib/kids-session";

export async function GET(request: NextRequest) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json(
        { message: "Not logged in" },
        { status: 401 }
      );
    }

    const child = session.child as {
      first_name?: string | null;
      profile_image?: string | null;
    };

    const name =
      (child.first_name != null && String(child.first_name).trim() !== ""
        ? String(child.first_name).trim()
        : "Friend");

    const avatar_url =
      (child.profile_image as string | null | undefined) ?? null;

    return NextResponse.json({
      kid_id: session.kid_id,
      name,
      avatar_url,
    });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error ? e.message : "Failed to load kid session",
      },
      { status: 500 }
    );
  }
}

