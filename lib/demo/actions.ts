"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { safeNext } from "./stories";

/** Persona sign-in (demo login): email of the persona, and where to land afterwards. */
export async function signInAs(formData: FormData) {
  try {
    await signIn("credentials", { email: String(formData.get("email")), redirectTo: safeNext(formData.get("next")) });
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=1");
    throw e;
  }
}
