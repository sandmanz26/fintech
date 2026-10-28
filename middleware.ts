import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { authConfig } from "./auth.config";

/**
 * Page-level gate: unauthenticated visitors to internal pages go to /login. Fine-grained RBAC is
 * enforced again in every route handler and service.
 *
 * The session token is only read here, never re-issued. Auth.js's own middleware refreshes the
 * cookie on every request, including the router's background prefetches; a prefetch that started
 * before a sign-in finished after it and put the previous person's session back (seen when
 * switching persona). Sessions now last a fixed 10 hours from sign-in.
 */
const PUBLIC = (p: string) => p === "/login" || p.startsWith("/portal") || p.startsWith("/api/v1/portal") || p.startsWith("/api/auth");

export default async function middleware(req: NextRequest) {
  // Without a secret Auth.js throws, which hosts show as an opaque middleware failure.
  if (!authConfig.secret) {
    return new Response("Sentinel is not configured: set AUTH_SECRET (32 random bytes, base64) in the environment and redeploy.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const { pathname, search } = req.nextUrl;
  // Route handlers answer JSON 401/403 themselves.
  if (PUBLIC(pathname) || pathname.startsWith("/api/")) return NextResponse.next();
  const secure = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const token = await getToken({ req, secret: authConfig.secret, secureCookie: secure });
  if (token?.uid) return NextResponse.next();
  const login = new URL("/login", req.nextUrl);
  if (pathname !== "/") login.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|opengraph-image.png|logo.svg).*)"],
};
