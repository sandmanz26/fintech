import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { db } from "@/lib/db";

/**
 * Demo login: pick a persona, no password. Swap the Credentials provider for SSO in production;
 * nothing else depends on how the user signed in.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(raw) {
        const parsed = z.object({ email: z.string().email() }).safeParse(raw);
        if (!parsed.success) return null;
        const user = await db.user.findUnique({ where: { email: parsed.data.email } });
        if (!user || !user.active) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role, merchantId: user.merchantId };
      },
    }),
  ],
});
