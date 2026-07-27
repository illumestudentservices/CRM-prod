import type { Metadata } from "next";
import { AuthBackground } from "./_components/auth-background";
import { AuthContent } from "./_components/auth-content";

export const metadata: Metadata = {
  title: "Sign In — Illume Student Advisory Services",
  description: "Sign in to your Illume Student Advisory Services account",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative overflow-hidden bg-[#04080F]">
      <AuthBackground />
      <AuthContent>{children}</AuthContent>
    </div>
  );
}
