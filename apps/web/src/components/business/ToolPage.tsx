"use client";

import {
  AlertsPanel,
  PayrollPanel,
  WithdrawPanel,
} from "@/components/ServicePanels";

import { InvoicesPage, SavingsPage, SellPage } from "./GetPaid";
import type { ToolSlug } from "./tools";
import { WalletPage } from "./WalletPage";

const PAGES: Record<ToolSlug, () => React.JSX.Element> = {
  wallet: WalletPage,
  sell: SellPage,
  invoices: InvoicesPage,
  savings: SavingsPage,
  payroll: PayrollPanel,
  withdrawals: WithdrawPanel,
  alerts: AlertsPanel,
};

export function ToolPage({ slug }: { slug: string }) {
  const Page = PAGES[slug as ToolSlug];
  return Page ? <Page /> : null;
}
