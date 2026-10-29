import { cookies } from "next/headers";
import type { Lang } from "./briefings";

/** Language for the explanations (briefings, case explainers): Indonesian unless English was chosen. */
export async function briefLang(): Promise<Lang> {
  const c = await cookies();
  return c.get("lang")?.value === "en" ? "en" : "id";
}
