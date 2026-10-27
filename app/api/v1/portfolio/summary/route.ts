import { json, route } from "@/lib/api";
import { portfolioSummary } from "@/lib/queries/portfolio";

/** GET /portfolio/summary — data behind the portfolio dashboard (RISK_MANAGER, COMPLIANCE). */
export const GET = route({ cap: ["approval.decide", "approval.decide.termination_compliance"] }, async () => json(await portfolioSummary()));
