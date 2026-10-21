import type { Metadata } from "next";

import { ApiPlayground } from "@/components/ApiPlayground";

export const metadata: Metadata = { title: "API playground · Roqqu Studio" };

export default function PlaygroundPage() {
  return <ApiPlayground />;
}
