import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create a free account",
  description: "Create a free FinDost AI workspace for your shop, enterprise, household or student budget. Email verification keeps your account safe.",
  alternates: { canonical: "/signup" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
