"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { ControlEditor } from "@/components/controls/ControlEditor";
import { TerminateDialog } from "./TerminateDialog";
import { ProfileDialog, type DeclaredProfile } from "./ProfileDialog";
import { useToast } from "@/components/ui/Toast";

type Ctx = { merchantName: string; today: string; reasons: { code: string; label: string; merchantFacingText: string; category: string }[] };

export function MerchantActions({ merchantId, canControl, canRescore, canTerminate, processing, profile }: { merchantId: string; canControl: boolean; canRescore: boolean; canTerminate: boolean; processing: boolean; profile: DeclaredProfile }) {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [controlOpen, setControlOpen] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadCtx() {
    if (ctx) return ctx;
    const c = await api<Ctx>(`/merchants/${merchantId}/action-context`);
    setCtx(c);
    return c;
  }
  // Deep link: ?control=new opens the editor (used from cases and the dashboard).
  useEffect(() => {
    if (sp.get("control") === "new" && canControl) loadCtx().then(() => setControlOpen(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, canControl]);

  async function rescore() {
    setBusy(true);
    try {
      const r = await api<{ score: number; band: string; previousBand: string | null }>(`/merchants/${merchantId}/rescore`, { body: {} });
      toast(`Re-scored: ${r.score} (${r.band.toLowerCase()})${r.previousBand && r.previousBand !== r.band ? `, was ${r.previousBand.toLowerCase()}` : ""}.`);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not re-score.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row-gap" style={{ flex: "none" }}>
      {canRescore ? (
        <button className="btn" onClick={rescore} disabled={busy}>
          <RefreshCw /> Re-score
        </button>
      ) : null}
      {canControl && processing ? (
        <button
          className="btn primary"
          data-testid="add-control"
          onClick={async () => {
            await loadCtx();
            setControlOpen(true);
          }}
        >
          <Plus /> Add control
        </button>
      ) : null}
      {canTerminate || (canRescore && processing) ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="btn" aria-label="More actions">
            <MoreHorizontal />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" align="end" sideOffset={6}>
              {canRescore && processing ? (
                <DropdownMenu.Item className="menu-item" onSelect={() => setProfileOpen(true)} data-testid="update-profile">
                  Update declared profile…
                </DropdownMenu.Item>
              ) : null}
              {canTerminate ? (
                <DropdownMenu.Item
                  className="menu-item"
                  style={{ color: "var(--negative)" }}
                  onSelect={async () => {
                    await loadCtx();
                    setTermOpen(true);
                  }}
                >
                  Propose termination…
                </DropdownMenu.Item>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}
      {profileOpen ? <ProfileDialog merchantId={merchantId} profile={profile} open={profileOpen} onOpenChange={setProfileOpen} /> : null}
      {ctx ? (
        <>
          <ControlEditor
            merchantId={merchantId}
            merchantName={ctx.merchantName}
            today={ctx.today}
            reasons={ctx.reasons.filter((r) => r.category === "CONTROL")}
            caseId={sp.get("caseId") ?? undefined}
            initialType={sp.get("type") ?? undefined}
            open={controlOpen}
            onOpenChange={(o) => {
              setControlOpen(o);
              if (!o && sp.get("control")) router.replace(`/merchants/${merchantId}${window.location.pathname.endsWith("/controls") ? "/controls" : ""}`);
            }}
          />
          <TerminateDialog merchantId={merchantId} merchantName={ctx.merchantName} reasons={ctx.reasons.filter((r) => r.category === "TERMINATION")} open={termOpen} onOpenChange={setTermOpen} caseId={sp.get("caseId") ?? undefined} />
        </>
      ) : null}
    </div>
  );
}
