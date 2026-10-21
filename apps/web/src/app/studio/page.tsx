import type { Metadata } from "next";

import { StudioApp } from "@/components/StudioApp";

export const metadata: Metadata = { title: "Studio · Roqqu Studio" };

export default function StudioPage() {
  return <StudioApp />;
}
