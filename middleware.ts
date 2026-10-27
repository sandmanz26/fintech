import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Page-level gate: unauthenticated visitors to internal pages go to /login.
// Fine-grained RBAC is enforced again in every route handler and service.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
