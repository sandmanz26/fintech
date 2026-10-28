import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";
import { isMockMode } from "./lib/mode";

/** Auth.js config without database access (the provider lives in auth.ts). */
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
  },
} satisfies NextAuthConfig;

declare module "next-auth" {
  interface Session {
    user: { id: string; name?: string | null; email?: string | null; role: Role; merchantId: string | null };
  }
}
