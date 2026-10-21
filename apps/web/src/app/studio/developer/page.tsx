import type { Metadata } from "next";

import { DeveloperHome } from "@/components/DeveloperHome";

export const metadata: Metadata = { title: "Developer tools · Roqqu Studio" };

export default function DeveloperPage() {
  return <DeveloperHome />;
}
