import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { checkUploadSize } from "@/lib/uploads";


type Params = { params: Promise<{ id: string; contractId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await effectiveHasPermission(session.user.role, "institutions", "read")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { contractId } = await params;

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

  const buffer = Buffer.from(await file.arrayBuffer());

  const attachment = await db.contractAttachment.create({
    data: {
      contractId,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      data: buffer,
    },
    select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
  });

  return NextResponse.json(attachment, { status: 201 });
}
