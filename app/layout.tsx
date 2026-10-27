import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { themePref } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sentinel", template: "%s · Sentinel" },
  description: "Merchant risk lifecycle workspace",
  icons: { icon: "/icon.svg" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await themePref();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} data-theme={theme === "system" ? undefined : theme} suppressHydrationWarning>
      <head>
        {/* Follow the OS theme when no preference is stored, before first paint. */}
        {theme === "system" ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `try{if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.dataset.theme='dark'}catch(e){}`,
            }}
          />
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
