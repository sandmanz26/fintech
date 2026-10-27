"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

export function MarkRead({ ids }: { ids: string[] }) {
  const router = useRouter();
  return (
    <button
      className="link meta"
      onClick={async () => {
        await api("/notifications/read", { body: { ids } });
        router.refresh();
      }}
    >
      Mark all read
    </button>
  );
}
