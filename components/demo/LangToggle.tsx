"use client";

import { useRouter } from "next/navigation";

/** Switches the explanations between Bahasa Indonesia and English (a cookie; the rest of the UI stays). */
export function LangToggle({ lang }: { lang: "id" | "en" }) {
  const router = useRouter();
  const next = lang === "id" ? "en" : "id";
  return (
    <button
      type="button"
      className="link meta"
      onClick={() => {
        document.cookie = `lang=${next}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
      data-testid="lang-toggle"
    >
      {lang === "id" ? "English" : "Bahasa Indonesia"}
    </button>
  );
}
