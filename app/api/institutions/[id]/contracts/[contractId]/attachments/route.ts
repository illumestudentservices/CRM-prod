import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { checkUploadSize } from "@/lib/uploads";
import { validateAttachment } from "@/lib/attachment-safety";
import { institutionIdsForUser } from "@/lib/lead-access";
import type { Role } from "@/lib/permissions";


type Params = { params: Promise<{ id: string; contractId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await effectiveHasPermission(session.user.role, "institutions", "read")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, contractId } = await params;

  // The listing was keyed on contractId alone, so any contract's attachment
  // index was readable through any institution id in the path — the same gap the
  // POST below already closes for writes.
  const contract = await db.contract.findFirst({
    where: { id: contractId, institutionId: id },
    select: { id: true },
  });
  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  if (session.user.role === "INSTITUTION_CLIENT") {
    const allowed = await institutionIdsForUser(session.user.id, session.user.role as Role);
    if (!allowed.includes(id)) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
  }

  const attachments = await db.contractAttachment.findMany({
    where: { contractId },
    select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(attachments);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await effectiveHasPermission(session.user.role, "institutions", "write")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, contractId } = await params;

  const contract = await db.contract.findFirst({
    where: { id: contractId, institutionId: id },
  });
  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  // The real control. The client checks too, but only so the user finds out
  // instantly — a direct request would skip it entirely.
  const sizeCheck = checkUploadSize(file);
  if (!sizeCheck.ok) {
    return NextResponse.json({ error: sizeCheck.message }, { status: 413 });
  }

  // Spec pentest H-4 — refuse blocked types (html/svg/exe/…), require an
  // allowlisted MIME, and persist only the canonical MIME + sanitised name.
  const check = validateAttachment(file);
  if (!check.ok) {
    return NextResponse.json({ error: check.message }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const attachment = await db.contractAttachment.create({
    data: {
      contractId,
      name: check.safeName!,
      mimeType: check.canonicalMime!,
      size: file.size,
      data: buffer,
    },
    select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
  });

  return NextResponse.json(attachment, { status: 201 });
}
