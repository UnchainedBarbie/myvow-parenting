import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const allowedTypes = ["image/jpeg", "image/png"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type. Use JPG or PNG." },
        { status: 400 }
      );
    }

    const maxSizeBytes = 2 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return NextResponse.json(
        { error: "File too large. Max 2MB." },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const bucket = "avatars";
    const fileExt = file.name.split(".").pop() ?? "jpg";
    const safeExt = fileExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const objectPath = `users/${user.id}/profile.${safeExt}`;

    const { error: uploadError } = await admin.storage.from(bucket).upload(objectPath, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type,
    });

    if (uploadError) {
      return NextResponse.json(
        { error: uploadError.message ?? "Upload failed" },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl },
    } = admin.storage.from(bucket).getPublicUrl(objectPath);

    const { error: updateError } = await admin
      .from("users")
      .update({ profile_image: publicUrl })
      .eq("id", user.id);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message ?? "Failed to save image" },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: publicUrl });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 500 }
    );
  }
}

