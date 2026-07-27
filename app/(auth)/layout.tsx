import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import { AuthBackground } from "./_components/auth-background";
import { AuthContent } from "./_components/auth-content";

/**
 * Fraunces carries the brand voice on these screens — a warm, optical-sized
 * serif that reads academic without tipping into stuffy. Scoped to the auth
 * route group; the app itself stays on Geist.
 */
const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sign In — Illume Student Advisory Services",
  description: "Sign in to your Illume Student Advisory Services account",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${display.variable} min-h-screen relative overflow-hidden bg-[#04080F]`}
    >
      <AuthBackground />
      <AuthContent>{children}</AuthContent>
    </div>
  );
}
