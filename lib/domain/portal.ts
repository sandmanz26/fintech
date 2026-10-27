import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { record } from "@/lib/domain/audit";
import { closeRfi } from "@/lib/domain/cases/service";
import { DomainError, NotFoundError } from "@/lib/errors";
import { storage, sniffType, MAX_UPLOAD_BYTES } from "@/lib/storage";

export type RfiItem = { key: string; label: string; docType: string; required: boolean; status: string };

/**
 * What the merchant portal may see (PRD §6.4): the message, the items, the due date and the
 * merchant's own trading name. Never the score, rule names, case notes or reviewer names.
 */
export async function portalView(token: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return { state: "invalid" as const };
  const rfi = await db.rfi.findUnique({ where: { token } });
  if (!rfi) return { state: "invalid" as const };
  const at = await now();
  const m = await db.merchant.findUniqueOrThrow({ where: { id: rfi.merchantId }, select: { dbaName: true, legalName: true } });
  const base = { merchantName: m.dbaName ?? m.legalName, message: rfi.messageToMerchant, dueAt: rfi.dueAt, items: (rfi.items as RfiItem[]).map(({ key, label, required, status }) => ({ key, label, required, status })) };
  if (rfi.revokedAt || rfi.status === "ANSWERED") return { state: "done" as const, ...base };
  if (rfi.expiresAt < at) return { state: "expired" as const, ...base };
  return { state: "open" as const, overdue: rfi.dueAt < at, ...base };
}

export async function portalUpload(token: string, itemKey: string, file: { name: string; bytes: Buffer }) {
  const rfi = await db.rfi.findUnique({ where: { token } });
  if (!rfi) throw new NotFoundError("Request");
  const at = await now();
  if (rfi.revokedAt || rfi.status === "ANSWERED") throw new DomainError("CLOSED", "This request is already complete. Thank you.", 410);
  if (rfi.expiresAt < at) throw new DomainError("EXPIRED", "This link has expired. Please contact us for a new one.", 410);
  if (file.bytes.length === 0) throw new DomainError("EMPTY", "The file is empty.", 400);
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw new DomainError("TOO_LARGE", "Files can be up to 10 MB.", 413);
  const kind = sniffType(file.bytes);
  if (!kind) throw new DomainError("BAD_TYPE", "Please upload a PDF, JPG or PNG file.", 415);
  const items = rfi.items as RfiItem[];
  const item = items.find((i) => i.key === itemKey);
  if (!item) throw new DomainError("BAD_ITEM", "That item is not part of this request.", 400);
  const key = await storage.put(file.bytes, { ext: kind.ext, prefix: "rfi" });
  return db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        merchantId: rfi.merchantId,
        type: item.docType,
        fileKey: key,
        fileName: file.name.replace(/[^\w.\- ]/g, "_").slice(0, 120),
        mimeType: kind.mime,
        sizeBytes: file.bytes.length,
        rfiId: rfi.id,
        uploadedBy: "merchant-portal",
        uploadedAt: at,
      },
    });
    item.status = "RECEIVED";
    const allIn = items.filter((i) => i.required).every((i) => i.status === "RECEIVED");
    await tx.rfi.update({ where: { id: rfi.id }, data: { items: items as never, status: allIn ? "ANSWERED" : "PARTIALLY_ANSWERED" } });
    await tx.caseEvent.create({ data: { caseId: rfi.caseId, type: "NOTE", payload: { body: `Merchant uploaded “${doc.fileName}” for: ${item.label}`, documentId: doc.id, system: true }, createdAt: at } });
    await record(tx, { id: null, role: "MERCHANT" }, { action: "RFI_DOCUMENT_UPLOADED", entityType: "Rfi", entityId: rfi.id, after: { documentId: doc.id, item: item.key, size: doc.sizeBytes } });
    if (allIn) await closeRfi(tx, rfi.id, "ANSWERED");
    return { received: item.key, complete: allIn };
  });
}
