import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";
import { isMockMode } from "./lib/mode";

/** Edge-safe part of the Auth.js config (no database access), shared with middleware. */
export const authConfig = {
  // Demo mode (no database, fictional data, persona login) works without configuration; a real
  // deployment must set AUTH_SECRET.
  secret: process.env.AUTH_SECRET ?? (isMockMode() ? "sentinel-demo-mode-not-for-production-use" : undefined),
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 10 },
  trustHost: true,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = (user as { id: string }).id;
        token.role = (user as { role: Role }).role;
        token.merchantId = (user as { merchantId?: string | null }).merchantId ?? null;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid as string;
      session.user.role = token.role as Role;
      session.user.merchantId = (token.merchantId as string | null) ?? null;
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic =
        pathname === "/login" ||
        pathname.startsWith("/portal") ||
        pathname.startsWith("/api/v1/portal") ||
        pathname.startsWith("/api/auth");
      if (isPublic) return true;
      if (pathname.startsWith("/api/")) return true; // route handlers return JSON 401/403 themselves
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;

declare module "next-auth" {
  interface Session {
    user: { id: string; name?: string | null; email?: string | null; role: Role; merchantId: string | null };
  }
}
