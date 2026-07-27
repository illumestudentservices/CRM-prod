import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Set Up Two-Factor Authentication — Illume Student Advisory Services",
  description: "Two-factor authentication is required on all accounts",
};

export default function Setup2FALayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
