import { BusinessShell } from "@/components/business/BusinessShell";

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return <BusinessShell>{children}</BusinessShell>;
}
