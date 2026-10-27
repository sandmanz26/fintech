import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** File storage behind an interface; v1 writes to a local folder, swap for S3 in production. */
export interface StorageAdapter {
  put(data: Buffer, opts: { ext: string; prefix?: string }): Promise<string>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

const root = path.resolve(process.env.STORAGE_DIR ?? "./storage");

function safePath(key: string) {
  const p = path.resolve(root, key);
  if (!p.startsWith(root + path.sep)) throw new Error("Invalid storage key");
  return p;
}

export const storage: StorageAdapter = {
  async put(data, { ext, prefix = "docs" }) {
    const key = `${prefix}/${new Date().toISOString().slice(0, 7)}/${randomBytes(12).toString("hex")}.${ext.replace(/[^a-z0-9]/gi, "")}`;
    const p = safePath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
    return key;
  },
  async get(key) {
    return readFile(safePath(key));
  },
  async exists(key) {
    try {
      await stat(safePath(key));
      return true;
    } catch {
      return false;
    }
  },
};

/** Upload rules (PRD §8): PDF, JPG or PNG up to 10 MB, checked by magic bytes, not by name. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export function sniffType(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  return null;
}

/** A minimal one-page PDF with a line of text, for seeded documents. */
export function tinyPdf(text: string): Buffer {
  const safe = text.replace(/[()\\]/g, "");
  const content = `BT /F1 14 Tf 72 720 Td (${safe}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
