import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const childId = params.id;
    if (!childId) {
      return NextResponse.json({ error: "Missing child id" }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type. Use JPG or PNG." },
        { status: 400 }
      );
    }

    const maxSizeBytes = 5 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return NextResponse.json(
        { error: "File too large. Max 5MB." },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: childRow, error: childError } = await admin
      .from("children")
      .select("id, case_id")
      .eq("id", childId)
      .maybeSingle();

    if (childError || !childRow) {
      return NextResponse.json({ error: "Child not found" }, { status: 404 });
    }

    const caseId = childRow.case_id as string | null;
    if (!caseId) {
      return NextResponse.json(
        { error: "Child is not linked to a case" },
        { status: 400 }
      );
    }

    const { data: membership } = await admin
      .from("case_members")
      .select("id")
      .eq("case_id", caseId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const bucket = "avatars";
    const fileExt = file.name.split(".").pop() ?? "jpg";
    const safeExt = fileExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const objectPath = `children/${childId}/${Date.now()}.${safeExt}`;

    const { error: uploadError } = await admin.storage
      .from(bucket)
      .upload(objectPath, file, {
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
      .from("children")
      .update({ profile_image: publicUrl })
      .eq("id", childId);

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

