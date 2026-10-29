"use client";

import { useEffect } from "react";

/** Remembers the landing page's language so the in-app explanations follow it. */
export function LangCookie({ lang }: { lang: "id" | "en" }) {
  useEffect(() => {
    document.cookie = `lang=${lang}; path=/; max-age=31536000; samesite=lax`;
  }, [lang]);
  return null;
}
