import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { SessionUser } from "@/lib/api";
import { isInternal } from "@/lib/auth/rbac";

export async function getSessionUser(): Promise<SessionUser | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  return { id: s.user.id, role: s.user.role, name: s.user.name ?? "", merchantId: s.user.merchantId };
}

/** Internal pages: signed in as staff, or back to the login screen. */
export async function requireStaff(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  if (!isInternal(u.role)) redirect("/login?denied=1");
  return u;
}

/** The viewer's time zone (set by the browser into a cookie); UTC until known. */
export async function viewerTz(): Promise<string> {
  const c = await cookies();
  const tz = c.get("tz")?.value;
  try {
    if (tz) new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

export async function themePref(): Promise<"light" | "dark" | "system"> {
  const c = await cookies();
  const t = c.get("theme")?.value;
  return t === "dark" || t === "light" ? t : "system";
}
