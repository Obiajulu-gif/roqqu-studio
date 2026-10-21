import type { Metadata } from "next";

import { StudioApp } from "@/components/StudioApp";

export const metadata: Metadata = { title: "Flow canvas · Roqqu Studio" };

export default function CanvasPage() {
  return <StudioApp forceDeveloper />;
}
