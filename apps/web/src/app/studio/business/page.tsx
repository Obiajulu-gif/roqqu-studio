import type { Metadata } from "next";

import { BusinessOverview } from "@/components/business/BusinessOverview";

export const metadata: Metadata = { title: "Your business · Roqqu Studio" };

export default function BusinessHome() {
  return <BusinessOverview />;
}
