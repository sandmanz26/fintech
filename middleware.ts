import type { NextFetchEvent, NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { isMockMode } from "./lib/mode";

const authMiddleware = NextAuth(authConfig).auth as unknown as (req: NextRequest, ev: NextFetchEvent) => Promise<Response | undefined>;

// Page-level gate: unauthenticated visitors to internal pages go to /login.
// Fine-grained RBAC is enforced again in every route handler and service.
export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  // Without a secret Auth.js throws, which hosts show as an opaque middleware failure.
  if (!process.env.AUTH_SECRET && !isMockMode()) {
    return new Response("Sentinel is not configured: set AUTH_SECRET (32 random bytes, base64) in the environment and redeploy.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return authMiddleware(req, ev);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
