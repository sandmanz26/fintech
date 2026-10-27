import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { route } from "@/lib/api";
import { storage } from "@/lib/storage";
import { NotFoundError } from "@/lib/errors";

/** Streams a stored document to internal staff. Served inline with its sniffed type only. */
export const GET = route<{ id: string }>({ cap: "merchant.read" }, async (_req, { params }) => {
  const d = await db.document.findUnique({ where: { id: params.id } });
  if (!d) throw new NotFoundError("Document");
  const buf = await storage.get(d.fileKey);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": d.mimeType ?? "application/octet-stream",
      "content-disposition": `inline; filename="${(d.fileName ?? "document").replace(/[^\w.-]/g, "_")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});
