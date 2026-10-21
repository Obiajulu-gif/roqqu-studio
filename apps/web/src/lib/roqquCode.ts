/**
 * JavaScript snippets for the Roqqu API playground, generated from the
 * endpoint catalog (developers.roqqu.com). Pure functions, so they are tested.
 */

export interface RoqquParam {
  name: string;
  in: "query" | "body" | "path";
  required: boolean;
  type: string;
  default: string | number;
  description: string;
}

export interface RoqquEndpoint {
  id: string;
  section: string;
  title: string;
  summary: string;
  method: "GET" | "POST";
  path: string;
  auth: boolean;
  moves_money: boolean;
  paid_lookup: boolean;
  note: string;
  params: RoqquParam[];
  examples: Record<string, unknown>;
  doc_url: string;
}

export interface RoqquWebhook {
  title: string;
  summary: string;
  payload: Record<string, string>;
  note: string;
  doc_url: string;
}

export interface RoqquCatalog {
  base_url: string;
  auth: string;
  endpoints: RoqquEndpoint[];
  webhook: RoqquWebhook;
  live_key?: boolean;
  production_allowed?: boolean;
}

export type ParamValues = Record<string, string>;

const IDENT = /^[A-Za-z_$][\w$]*$/;

function literal(value: string, type: string): string {
  if ((type === "number" || type === "integer") && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return String(Number(value));
  }
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function objectLiteral(entries: [string, string][], indent: string): string {
  if (entries.length === 0) return "{}";
  const inner = entries
    .map(([k, v]) => `${indent}  ${IDENT.test(k) ? k : `'${k}'`}: ${v}`)
    .join(",\n");
  return `{\n${inner}\n${indent}}`;
}

/** The values a request would actually send: required ones always, optional ones when filled. */
export function sentParams(endpoint: RoqquEndpoint, values: ParamValues) {
  const pick = (where: RoqquParam["in"]) =>
    endpoint.params
      .filter((p) => p.in === where)
      .filter((p) => p.required || (values[p.name] ?? "") !== "")
      .map((p) => [p.name, literal(values[p.name] ?? "", p.type)] as [string, string]);
  let path = endpoint.path;
  for (const p of endpoint.params.filter((x) => x.in === "path")) {
    path = path.replace(`{${p.name}}`, values[p.name] || `{${p.name}}`);
  }
  return { path, query: pick("query"), body: pick("body") };
}

export function defaultValues(endpoint: RoqquEndpoint): ParamValues {
  return Object.fromEntries(endpoint.params.map((p) => [p.name, String(p.default ?? "")]));
}

function headerLines(endpoint: RoqquEndpoint, indent: string): string {
  const lines = [`${indent}  accept: 'application/json'`];
  if (endpoint.method !== "GET") lines.push(`${indent}  'content-type': 'application/json'`);
  if (endpoint.auth) lines.push(`${indent}  Authorization: \`Bearer \${process.env.ROQQU_SECRET_KEY}\``);
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** axios, in the same shape as the samples on developers.roqqu.com. */
export function axiosSnippet(catalog: RoqquCatalog, endpoint: RoqquEndpoint, values: ParamValues): string {
  const { path, query, body } = sentParams(endpoint, values);
  const parts = [
    `  method: '${endpoint.method}'`,
    `  url: '${catalog.base_url}${path}'`,
  ];
  if (query.length) parts.push(`  params: ${objectLiteral(query, "  ")}`);
  parts.push(`  headers: ${headerLines(endpoint, "  ")}`);
  if (endpoint.method !== "GET") parts.push(`  data: ${objectLiteral(body, "  ")}`);
  return [
    "const axios = require('axios');",
    "",
    `const options = {\n${parts.join(",\n")}\n};`,
    "",
    "axios",
    "  .request(options)",
    "  .then((res) => console.log(res.data))",
    "  .catch((err) => console.error(err.response?.data ?? err.message));",
    "",
  ].join("\n");
}

/** Native fetch (Node 18+ or the browser's fetch on your own server). */
export function fetchSnippet(catalog: RoqquCatalog, endpoint: RoqquEndpoint, values: ParamValues): string {
  const { path, query, body } = sentParams(endpoint, values);
  const lines = [`const url = new URL('${catalog.base_url}${path}');`];
  for (const [k, v] of query) lines.push(`url.searchParams.set('${k}', ${v.startsWith("'") ? v : `'${v}'`});`);
  lines.push("");
  const init = [`  method: '${endpoint.method}'`, `  headers: ${headerLines(endpoint, "  ")}`];
  if (endpoint.method !== "GET") init.push(`  body: JSON.stringify(${objectLiteral(body, "  ")})`);
  lines.push(`const res = await fetch(url, {\n${init.join(",\n")}\n});`);
  lines.push("const json = await res.json();");
  lines.push("if (json.status !== 'success') throw new Error(json.message);");
  lines.push("console.log(json.data);");
  lines.push("");
  return lines.join("\n");
}

export function functionName(id: string): string {
  return id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** The same call through the downloadable roqqu.js client. */
export function clientSnippet(endpoint: RoqquEndpoint, values: ParamValues): string {
  const args = endpoint.params
    .filter((p) => p.required || (values[p.name] ?? "") !== "")
    .map((p) => [p.name, literal(values[p.name] ?? "", p.type)] as [string, string]);
  const call = args.length ? objectLiteral(args, "") : "";
  return [
    "const roqqu = require('./roqqu')(process.env.ROQQU_SECRET_KEY);",
    "",
    `const data = await roqqu.${functionName(endpoint.id)}(${call});`,
    "console.log(data);",
    "",
  ].join("\n");
}

/** A dependency-free client covering every endpoint in the catalog. */
export function clientModule(catalog: RoqquCatalog): string {
  const methods = catalog.endpoints.map((e) => {
    const names = e.params.map((p) => p.name);
    const arg = names.length ? `{ ${names.join(", ")} } = {}` : "";
    const pathExpr = e.params.some((p) => p.in === "path")
      ? "`" + e.path.replace(/\{(\w+)\}/g, "${$1}") + "`"
      : `'${e.path}'`;
    const pick = (where: RoqquParam["in"]) => e.params.filter((p) => p.in === where).map((p) => p.name);
    const opts: string[] = [];
    if (pick("query").length) opts.push(`query: { ${pick("query").join(", ")} }`);
    if (pick("body").length) opts.push(`body: { ${pick("body").join(", ")} }`);
    if (e.auth) opts.push("auth: true");
    const optsText = opts.length ? `, { ${opts.join(", ")} }` : "";
    const warn = e.moves_money ? " Moves real money." : e.paid_lookup ? " Paid lookup." : "";
    return [
      `    /** ${e.title}: ${e.method} ${e.path}.${warn} ${e.doc_url} */`,
      `    ${functionName(e.id)}: (${arg}) => request('${e.method}', ${pathExpr}${optsText}),`,
    ].join("\n");
  });
  return [
    "/**",
    " * roqqu.js: a tiny client for every endpoint in the Roqqu API reference",
    " * (https://developers.roqqu.com). Generated by Roqqu Studio. No dependencies;",
    " * needs Node 18+ for fetch. Keep your secret key on the server.",
    " *",
    " *   const roqqu = require('./roqqu')(process.env.ROQQU_SECRET_KEY);",
    " *   const btc = await roqqu.getPrice({ symbol: 'btc' });",
    " */",
    `const BASE_URL = '${catalog.base_url}';`,
    "",
    "module.exports = function roqqu(secretKey) {",
    "  async function request(method, path, { query, body, auth } = {}) {",
    "    const url = new URL(BASE_URL + path);",
    "    for (const [k, v] of Object.entries(query || {})) {",
    "      if (v !== undefined && v !== '') url.searchParams.set(k, v);",
    "    }",
    "    const headers = { accept: 'application/json' };",
    "    if (auth) {",
    "      if (!secretKey) throw new Error('This Roqqu endpoint needs your secret key');",
    "      headers.Authorization = `Bearer ${secretKey}`;",
    "    }",
    "    let payload;",
    "    if (method !== 'GET') {",
    "      headers['content-type'] = 'application/json';",
    "      payload = JSON.stringify(",
    "        Object.fromEntries(Object.entries(body || {}).filter(([, v]) => v !== undefined && v !== '')),",
    "      );",
    "    }",
    "    const res = await fetch(url, { method, headers, body: payload });",
    "    const json = await res.json().catch(() => ({ status: 'fail', message: `HTTP ${res.status}` }));",
    "    if (!res.ok || json.status !== 'success') {",
    "      const err = new Error(json.message || `Roqqu request failed (HTTP ${res.status})`);",
    "      err.status = res.status;",
    "      err.body = json;",
    "      throw err;",
    "    }",
    "    return json.data;",
    "  }",
    "",
    "  return {",
    methods.join("\n"),
    "  };",
    "};",
    "",
  ].join("\n");
}

/** Express handler for the Receive Token webhook. */
export function webhookSnippet(): string {
  return [
    "const express = require('express');",
    "const crypto = require('crypto');",
    "const roqqu = require('./roqqu')(process.env.ROQQU_SECRET_KEY);",
    "",
    "const app = express();",
    "app.use(express.json());",
    "",
    "// Set this URL and a secret on your Roqqu dashboard.",
    "app.post('/roqqu/webhook', async (req, res) => {",
    "  const { secret = '', token, amount, address } = req.body;",
    "  const expected = process.env.ROQQU_WEBHOOK_SECRET || '';",
    "  const ok =",
    "    expected.length > 0 &&",
    "    secret.length === expected.length &&",
    "    crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected));",
    "  if (!ok) return res.status(401).json({ error: 'bad secret' });",
    "",
    "  // The webhook is only a trigger. Ask Roqqu what really landed.",
    "  const wallets = await roqqu.getWallets({ token });",
    "  const wallet = wallets.find((w) => w.address === address);",
    "  if (!wallet) return res.json({ received: true, matched: false });",
    "",
    "  console.log(`${amount} ${token} reported; Roqqu shows ${wallet.total_received} received`);",
    "  // Mark the order paid here, once per address (idempotent).",
    "  res.json({ received: true, matched: true });",
    "});",
    "",
    "app.listen(3001);",
    "",
  ].join("\n");
}
