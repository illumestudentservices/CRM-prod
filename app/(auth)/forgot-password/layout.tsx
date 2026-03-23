import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset Password — Illume Student Advisory Services",
  description: "Request a password reset link for your Illume account",
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
