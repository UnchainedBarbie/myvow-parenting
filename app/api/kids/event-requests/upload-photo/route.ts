import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

const BUCKET = "event-request-photos";

/**
 * POST /api/kids/event-requests/upload-photo
 * Multipart form with "file" (image). Kid session required.
 * Uploads to event-request-photos/{case_id}/{timestamp}-{random}.jpg, returns { url }.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json({ message: "Not logged in" }, { status: 401 });
    }

    const child = session.child as { case_id?: string | null };
    const caseId = child.case_id ?? null;
    if (!caseId) {
      return NextResponse.json({ message: "No family case found" }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ message: "No file uploaded" }, { status: 400 });
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { message: "Unsupported file type. Use JPG, PNG, or WebP." },
        { status: 400 }
      );
    }
    const maxSizeBytes = 5 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return NextResponse.json(
        { message: "File too large. Max 5MB." },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 10);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
    const objectPath = `${caseId}/${timestamp}-${random}.${safeExt}`;

    const { data: buckets } = await admin.storage.listBuckets();
    if (!buckets?.some((b) => b.name === BUCKET)) {
      await admin.storage.createBucket(BUCKET, { public: true });
    }

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(objectPath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });

    if (uploadError) {
      return NextResponse.json(
        { message: uploadError.message ?? "Upload failed" },
        { status: 500 }
      );
    }

    const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(objectPath);
    return NextResponse.json({ url: publicUrl });
  } catch (e) {
    console.error("[kids/event-requests/upload-photo]", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Upload failed" },
      { status: 500 }
    );
  }
}
