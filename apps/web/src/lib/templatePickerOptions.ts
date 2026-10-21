/**
 * Template picker copy + options — Figma jj9fKZamdwfNDVD5rGQI9G
 * `#144:4304` / `#155:4959` (OQ-1: unique Ajo description).
 */

export const TEMPLATE_PICKER_TITLE = "What do you want to do?";

export const TEMPLATE_PICKER_SUBTITLE =
  "Pick a vetted product template. Safety nodes come built in.";

export const TEMPLATE_PICKER_SELECT_LABEL = "Select";
export const TEMPLATE_PICKER_SELECT_BUSY_LABEL = "Opening…";
export const TEMPLATE_PICKER_BACK_LABEL = "Back";

export type TemplatePickerOption = {
  id: string;
  title: string;
  description: string;
  image: string | null;
  kind: "template" | "other";
};

export const TEMPLATE_PICKER_OPTIONS: TemplatePickerOption[] = [
  {
    id: "sell-online",
    title: "Sell goods & services",
    description: "Setup a payment link and a dashboard for your orders",
    image: "/figma/templates/template-sell-goods.png",
    kind: "template",
  },
  {
    id: "ajo",
    title: "Start a savings group (Ajo)",
    description: "Collect member contributions and track the rotating pool",
    image: "/figma/templates/template-ajo.png",
    kind: "template",
  },
  {
    id: "invoice",
    title: "Send an invoice",
    description: "Create invoices to share to customers",
    image: "/figma/templates/template-send-invoice.png",
    kind: "template",
  },
  {
    id: "pay-bills",
    title: "Pay bills",
    description: "Sell electricity units and airtime through Roqqu",
    image: "/figma/templates/template-payments.png",
    kind: "template",
  },
  {
    id: "sell-data",
    title: "Sell data bundles",
    description: "Resell MTN, Airtel, Glo and 9mobile data with live Roqqu plans",
    image: "/figma/templates/template-data.svg",
    kind: "template",
  },
  {
    id: "payroll",
    title: "Pay staff in crypto",
    description: "Pay a list of people, each wallet checked before money moves",
    image: "/figma/templates/template-payroll.png",
    kind: "template",
  },
  {
    id: "withdrawals",
    title: "Customer withdrawals",
    description: "Let customers cash out crypto, address and balance checked first",
    image: "/figma/templates/template-withdraw.svg",
    kind: "template",
  },
  {
    id: "kyc",
    title: "Verify customers (KYC)",
    description: "BVN, NIN and bank account checks before anyone transacts",
    image: "/figma/templates/template-kyc.svg",
    kind: "template",
  },
  {
    id: "price-alerts",
    title: "Crypto price alerts",
    description: "Get a WhatsApp alert when a coin crosses your price",
    image: "/figma/templates/template-alerts.svg",
    kind: "template",
  },
  {
    id: "__other__",
    title: "Something else",
    description: "Describe what you want and let Rooky build it",
    image: null,
    kind: "other",
  },
];
