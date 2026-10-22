/**
 * JavaScript snippets for the Roqqu API playground, generated from the RAS
 * endpoint catalog (roqqu-api-services.gitbook.io/ras). Pure functions, so they
 * are tested.
 *
 * RAS facts every snippet follows: base https://service.roqqu.com/v1; a test key
 * rides in `x-staging-api-key`, a live key in `x-api-key`; POST bodies are form
 * fields (objects as JSON strings); replies are {status, message, data}.
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
  method: "GET" | "POST" | "DELETE";
  path: string;
  auth: boolean;
  moves_money: boolean;
  paid_lookup: boolean;
  side_effects?: boolean;
  note: string;
  params: RoqquParam[];
  examples: Record<string, unknown>;
  doc_url: string;
}

export interface RoqquWebhook {
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  note: string;
  doc_url: string;
}

export interface RoqquCatalog {
  base_url: string;
  auth: string;
  endpoints: RoqquEndpoint[];
  webhook: RoqquWebhook;
  live_key?: boolean;
  mode?: "practice" | "test" | "live";
  production_allowed?: boolean;
}

export type ParamValues = Record<string, string>;

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Every value travels as text: RAS reads form fields, and amounts stay exact. */
function literal(value: string): string {
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
      .map((p) => [p.name, literal(values[p.name] ?? "")] as [string, string]);
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
  if (endpoint.method !== "GET") lines.push(`${indent}  'content-type': 'application/x-www-form-urlencoded'`);
  // Test key in test mode; swap to 'x-api-key': process.env.RAS_LIVE_KEY for live.
  if (endpoint.auth) lines.push(`${indent}  'x-staging-api-key': process.env.RAS_TEST_KEY`);
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** axios, form-encoded the way the RAS curl examples are. */
export function axiosSnippet(catalog: RoqquCatalog, endpoint: RoqquEndpoint, values: ParamValues): string {
  const { path, query, body } = sentParams(endpoint, values);
  const parts = [
    `  method: '${endpoint.method}'`,
    `  url: '${catalog.base_url}${path}'`,
  ];
  if (query.length) parts.push(`  params: ${objectLiteral(query, "  ")}`);
  parts.push(`  headers: ${headerLines(endpoint, "  ")}`);
  if (endpoint.method !== "GET") parts.push(`  data: new URLSearchParams(${objectLiteral(body, "  ")})`);
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

/** Native fetch (Node 18+ or your own server). */
export function fetchSnippet(catalog: RoqquCatalog, endpoint: RoqquEndpoint, values: ParamValues): string {
  const { path, query, body } = sentParams(endpoint, values);
  const lines = [`const url = new URL('${catalog.base_url}${path}');`];
  for (const [k, v] of query) lines.push(`url.searchParams.set('${k}', ${v});`);
  lines.push("");
  const init = [`  method: '${endpoint.method}'`, `  headers: ${headerLines(endpoint, "  ")}`];
  if (endpoint.method !== "GET") init.push(`  body: new URLSearchParams(${objectLiteral(body, "  ")})`);
  lines.push(`const res = await fetch(url, {\n${init.join(",\n")}\n});`);
  lines.push("const json = await res.json();");
  lines.push("if (json.status !== 'success') throw new Error(json.message);");
  lines.push("console.log(json.data);");
  lines.push("");
  return lines.join("\n");
}

export function functionName(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** The same call through the downloadable roqqu.js client. */
export function clientSnippet(endpoint: RoqquEndpoint, values: ParamValues): string {
  const args = endpoint.params
    .filter((p) => p.required || (values[p.name] ?? "") !== "")
    .map((p) => [p.name, literal(values[p.name] ?? "")] as [string, string]);
  const call = args.length ? objectLiteral(args, "") : "";
  return [
    "const roqqu = require('./roqqu')({ testKey: process.env.RAS_TEST_KEY });",
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
    const warn = e.moves_money ? " Moves money." : e.side_effects ? " Changes your account." : "";
    return [
      `    /** ${e.title}: ${e.method} ${e.path}.${warn} ${e.doc_url} */`,
      `    ${functionName(e.id)}: (${arg}) => request('${e.method}', ${pathExpr}${optsText}),`,
    ].join("\n");
  });
  return [
    "/**",
    " * roqqu.js: a tiny client for every endpoint in the Roqqu API Service",
    " * (https://roqqu-api-services.gitbook.io/ras). Generated by Roqqu Studio.",
    " * No dependencies; needs Node 18+ for fetch. Keep your keys on the server.",
    " *",
    " *   const roqqu = require('./roqqu')({ testKey: process.env.RAS_TEST_KEY });",
    " *   const prices = await roqqu.getCryptoPrices();",
    " *",
    " * Pass { liveKey } instead of { testKey } to move real money.",
    " */",
    `const BASE_URL = '${catalog.base_url}';`,
    "",
    "module.exports = function roqqu({ testKey, liveKey } = {}) {",
    "  async function request(method, path, { query, body, auth } = {}) {",
    "    const url = new URL(BASE_URL + path);",
    "    for (const [k, v] of Object.entries(query || {})) {",
    "      if (v !== undefined && v !== '') url.searchParams.set(k, v);",
    "    }",
    "    const headers = { accept: 'application/json' };",
    "    if (auth) {",
    "      if (testKey) headers['x-staging-api-key'] = testKey;",
    "      else if (liveKey) headers['x-api-key'] = liveKey;",
    "      else throw new Error('This RAS endpoint needs a key: pass { testKey } or { liveKey }');",
    "    }",
    "    let payload;",
    "    if (method !== 'GET') {",
    "      headers['content-type'] = 'application/x-www-form-urlencoded';",
    "      const form = new URLSearchParams();",
    "      for (const [k, v] of Object.entries(body || {})) {",
    "        if (v === undefined || v === '') continue;",
    "        form.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));",
    "      }",
    "      payload = form.toString();",
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

/** Express handler for RAS webhooks: decrypt with your key, then treat it as a trigger. */
export function webhookSnippet(): string {
  return [
    "const express = require('express');",
    "const crypto = require('crypto');",
    "const roqqu = require('./roqqu')({ testKey: process.env.RAS_TEST_KEY });",
    "",
    "const API_KEY = process.env.RAS_TEST_KEY || process.env.RAS_LIVE_KEY;",
    "const app = express();",
    "app.use(express.json());",
    "",
    "// RAS encrypts the body with your API key (AES-256-CTR). The IV is the hex",
    "// value of the x-api-key request header. If it does not decrypt, it is not Roqqu.",
    "function decrypt(hash, iv) {",
    "  try {",
    "    const decipher = crypto.createDecipheriv('aes-256-ctr', API_KEY.substring(0, 32), Buffer.from(iv, 'hex'));",
    "    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(hash, 'hex')), decipher.final()]).toString());",
    "  } catch {",
    "    return null;",
    "  }",
    "}",
    "",
    "const seen = new Set(); // use your database in production",
    "",
    "// Set this URL in the RAS console: Settings -> API Keys and Webhooks.",
    "app.post('/roqqu/webhook', async (req, res) => {",
    "  const event = decrypt(req.body.hash ?? '', req.get('x-api-key') ?? '');",
    "  if (!event) return res.status(401).json({ error: 'not from Roqqu' });",
    "  if (seen.has(event.event_id)) return res.json({ received: true, duplicate: true });",
    "  seen.add(event.event_id);",
    "",
    "  const { address, network, value, token } = event.meta_data;",
    "  if (event.event_type === 'token_received') {",
    "    // The webhook is only a trigger. Ask Roqqu what really landed.",
    "    const addresses = await roqqu.getAddresses({ network });",
    "    const mine = addresses.find((w) => w.address === address);",
    "    console.log(`${value} ${token} reported; Roqqu shows ${mine?.total_received} received`);",
    "  }",
    "  // payment_link_completed / _overpaid / _failed, token_sent, token_refunded: handle here.",
    "  res.json({ received: true });",
    "});",
    "",
    "app.listen(3001);",
    "",
  ].join("\n");
}
