import type { Metadata } from "next";
import { CaptchaPreload } from "@/components/auth/captcha-preload";

export const metadata: Metadata = { title: "Account", robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CaptchaPreload />
      {children}
    </>
  );
}
