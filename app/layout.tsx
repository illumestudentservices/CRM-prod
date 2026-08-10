import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/providers/session-provider";
import { ToastProvider } from "@/components/providers/toast-provider";
import { ThemeProvider, ThemeInitScript } from "@/components/theme/provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Brand display face, used on the sign-in screens and the welcome hand-off.
 * Declared at the root because the welcome overlay portals to document.body and
 * would otherwise fall outside any scoped wrapper. Not preloaded — the app
 * itself runs on Geist.
 */
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Illume Student Advisory Services | CRM & ERP Platform",
  description: "Illume Student Advisory Services — Student recruitment, agent & school source tracking, institutional client relationships, event ROI analysis, workforce management, and automated reporting.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // suppressHydrationWarning: the ThemeInitScript modifies the html
      // element (adding/removing `dark`, setting data-theme + color-scheme)
      // before React hydrates. Without this, React logs a mismatch warning
      // on every load — the actual output is what we want.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        {/* Runs synchronously in <head> before body renders, so the very
            first paint already matches the saved theme. Without this we get
            a light-mode flash for dark-mode users. */}
        <ThemeInitScript />
      </head>
      <body className="h-full bg-background text-foreground">
        <ThemeProvider>
          <SessionProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
