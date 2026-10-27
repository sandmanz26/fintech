"use client";

import { useRouter } from "next/navigation";
import { DismissAlert } from "./AlertActions";

export function DismissInline({ alertId, reasons }: { alertId: string; reasons: { code: string; label: string }[] }) {
  const router = useRouter();
  return <DismissAlert alertId={alertId} reasons={reasons} onDone={() => router.refresh()} label="Dismiss alert" />;
}
