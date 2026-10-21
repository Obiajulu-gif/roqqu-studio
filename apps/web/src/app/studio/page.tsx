import type { Metadata } from "next";

import { StudioHome } from "@/components/StudioHome";

export const metadata: Metadata = { title: "Studio · Roqqu Studio" };

export default function StudioPage() {
  return <StudioHome />;
}
