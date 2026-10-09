import { AppProvider } from "@/components/app/app-provider";
import { AppShell } from "@/components/app/shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
