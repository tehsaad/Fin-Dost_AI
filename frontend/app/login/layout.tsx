import type { Metadata } from "next";
import { CaptchaPreload } from "@/components/auth/captcha-preload";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to FinDost AI, or open a private demo workspace with synthetic data — no sign-up needed.",
  alternates: { canonical: "/login" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CaptchaPreload />
      {children}
    </>
  );
}
