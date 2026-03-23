import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Two-Factor Authentication — Illume Student Advisory Services",
  description: "Enter your authentication code to continue",
};

export default function Verify2FALayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
