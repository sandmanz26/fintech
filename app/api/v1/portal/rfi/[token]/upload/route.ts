import { json, publicRoute, errorResponse } from "@/lib/api";
import { portalUpload } from "@/lib/domain/portal";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { clientIp, limited } from "@/lib/rateLimit";

/** POST multipart { itemKey, file } — PDF/JPG/PNG up to 10 MB, checked by content. */
export const POST = publicRoute<{ token: string }>(async (req, { params }) => {
  // Uploads are the expensive call: 20 per link and 30 per address in 10 minutes.
  const tooMany = limited([
    { key: `portal:up:${params.token}`, limit: 20, windowMs: 600_000 },
    { key: `portal:up:${clientIp(req)}`, limit: 30, windowMs: 600_000 },
  ]);
  if (tooMany) return tooMany;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) return errorResponse(413, "TOO_LARGE", "Files can be up to 10 MB.");
  const form = await req.formData();
  const file = form.get("file");
  const itemKey = String(form.get("itemKey") ?? "");
  if (!(file instanceof File)) return errorResponse(400, "NO_FILE", "Choose a file to upload.");
  const r = await portalUpload(params.token, itemKey, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
  return json(r, { status: 201 });
});
