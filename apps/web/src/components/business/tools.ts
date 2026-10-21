/**
 * Every business tool, its route and its group. One list drives the sidebar,
 * the overview cards and the /studio/business/[tool] pages.
 *
 * Grouped by what the owner is trying to do (Hick's and Miller's laws: four
 * small groups beat nine equal tabs).
 */

export type ToolSlug =
  | "sell"
  | "invoices"
  | "savings"
  | "payroll"
  | "withdrawals"
  | "bills"
  | "data"
  | "kyc"
  | "alerts";

export interface Tool {
  slug: ToolSlug;
  title: string;
  /** One line: what the owner gets, in their words. */
  blurb: string;
  group: ToolGroup;
  /** The studio template behind this tool. */
  template: string;
  icon: string;
}

export type ToolGroup = "Get paid" | "Pay out" | "Sell services" | "Customers & markets";

export const TOOL_GROUPS: { name: ToolGroup; lead: string }[] = [
  { name: "Get paid", lead: "Take crypto payments that Roqqu confirms." },
  { name: "Pay out", lead: "Send crypto to staff and customers." },
  { name: "Sell services", lead: "Resell electricity, airtime and data." },
  { name: "Customers & markets", lead: "Check who you deal with and watch prices." },
];

export const TOOLS: Tool[] = [
  {
    slug: "sell",
    title: "Sell online",
    blurb: "A shop link for WhatsApp. Orders turn paid only when coins land.",
    group: "Get paid",
    template: "sell-online",
    icon: "M4 7h16l-1.5 9a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7L4 7Zm4 0a4 4 0 0 1 8 0",
  },
  {
    slug: "invoices",
    title: "Invoices",
    blurb: "Bill a client in naira. They pay in BTC, ETH or TRX.",
    group: "Get paid",
    template: "invoice",
    icon: "M7 3h7l4 4v14H7V3Zm7 0v4h4M10 12h5M10 16h5",
  },
  {
    slug: "savings",
    title: "Savings group",
    blurb: "Run an ajo. Every member's contribution is checked.",
    group: "Get paid",
    template: "ajo",
    icon: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20c0-3 2.5-5 5-5s5 2 5 5m-2-5c1-.6 2.2-1 3-1 2.5 0 5 2 5 5",
  },
  {
    slug: "payroll",
    title: "Payroll",
    blurb: "Pay a list of staff in crypto, each wallet checked.",
    group: "Pay out",
    template: "payroll",
    icon: "M4 6h16v12H4V6Zm0 4h16M8 15h3",
  },
  {
    slug: "withdrawals",
    title: "Withdrawals",
    blurb: "Let customers cash out. Address checked before sending.",
    group: "Pay out",
    template: "withdrawals",
    icon: "M12 19V5m0 0-5 5m5-5 5 5M5 21h14",
  },
  {
    slug: "bills",
    title: "Bills",
    blurb: "Electricity units and airtime, meter checked by name.",
    group: "Sell services",
    template: "pay-bills",
    icon: "M13 3 5 14h6l-1 7 8-11h-6l1-7Z",
  },
  {
    slug: "data",
    title: "Data bundles",
    blurb: "Resell MTN, Airtel, Glo and 9mobile data.",
    group: "Sell services",
    template: "sell-data",
    icon: "M5 12a10 10 0 0 1 14 0M8 15a6 6 0 0 1 8 0M12 19h.01",
  },
  {
    slug: "kyc",
    title: "Verify customers",
    blurb: "BVN, NIN and bank account checks before anyone transacts.",
    group: "Customers & markets",
    template: "kyc",
    icon: "M4 5h16v14H4V5Zm4 9c.5-1.5 1.5-2 2-2s1.5.5 2 2M10 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm5-2h3m-3 3h3",
  },
  {
    slug: "alerts",
    title: "Price alerts",
    blurb: "Know when a coin crosses your price.",
    group: "Customers & markets",
    template: "price-alerts",
    icon: "M4 18 9 12l4 3 7-8M15 7h5v5",
  },
];

export const toolBySlug = (slug: string) => TOOLS.find((t) => t.slug === slug);
