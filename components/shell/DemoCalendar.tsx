"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

type Advanced = { closed: string; today: string; transactions: number; newAlerts: number; newCases: number };

/**
 * The simulated calendar and, where allowed, the button that moves it on a day: trading is
 * simulated and every daily job runs, exactly as `npm run demo:advance-day`.
 */
export function DemoCalendar({ today, canAdvance, demo }: { today: string; canAdvance: boolean; demo: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function advance() {
    setBusy(true);
    try {
      const r = await api<Advanced>("/demo/advance", { body: {} });
      const day = new Date(`${r.today}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      const what = r.newAlerts ? `${r.newAlerts} new alert${r.newAlerts === 1 ? "" : "s"}${r.newCases ? `, ${r.newCases} new case${r.newCases === 1 ? "" : "s"}` : ""}` : "no new alerts";
      toast(`Now ${day}. ${r.transactions.toLocaleString()} transactions simulated; ${what}.`);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not move the calendar.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "0 8px 10px" }} data-testid="demo-calendar">
      <div className="meta" title="Sentinel runs on a simulated calendar so a day of trading can be replayed on demand.">
        Today {today} · simulated{demo ? " · demo data" : ""}
      </div>
      {canAdvance ? (
        <button className="btn sm" style={{ marginTop: 8, width: "100%", justifyContent: "center" }} onClick={advance} disabled={busy} data-testid="advance-day" aria-live="polite">
          {busy ? "Simulating a day…" : (
            <>
              Next day <ChevronRight />
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
