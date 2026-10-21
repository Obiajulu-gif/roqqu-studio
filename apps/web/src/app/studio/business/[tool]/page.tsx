import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ToolPage } from "@/components/business/ToolPage";
import { TOOLS, toolBySlug } from "@/components/business/tools";

export function generateStaticParams() {
  return TOOLS.map((t) => ({ tool: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ tool: string }> }): Promise<Metadata> {
  const tool = toolBySlug((await params).tool);
  return { title: tool ? `${tool.title} · Roqqu Studio` : "Roqqu Studio" };
}

export default async function BusinessToolPage({ params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  if (!toolBySlug(tool)) notFound();
  return <ToolPage slug={tool} />;
}
