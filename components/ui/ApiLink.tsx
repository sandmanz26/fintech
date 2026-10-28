"use client";

import { apiRaw, inDemo } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

/**
 * A link to a file the API serves (CSV export, document preview). A plain link normally; in demo
 * mode the file is fetched through the bridge (lib/demo/bridge.ts) so it comes from the same
 * data the pages show, then saved or opened from memory.
 */
export function ApiLink({ path, download, children, ...rest }: { path: string; download?: boolean; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "download">) {
  const toast = useToast();
  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!inDemo()) return;
    e.preventDefault();
    // Open the tab now, inside the click, so pop-up blockers allow it; fill it when the file arrives.
    const tab = download ? null : window.open("about:blank", "_blank");
    try {
      const r = await apiRaw(path);
      if (r.status >= 400) throw new Error(r.text ? (JSON.parse(r.text)?.error?.message ?? "Not found") : "Not found");
      const blob = r.blob ?? new Blob([r.text ?? ""], { type: r.contentType });
      const url = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = r.filename ?? path.split("/").pop()?.split("?")[0] ?? "download";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else if (tab) tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      toast(err instanceof Error ? err.message : "Could not open the file.", "err");
    }
  }
  return (
    <a href={`/api/v1${path}`} download={download || undefined} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
