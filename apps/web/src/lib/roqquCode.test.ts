import vm from "node:vm";

import { describe, expect, it } from "vitest";

import {
  axiosSnippet,
  clientModule,
  clientSnippet,
  defaultValues,
  fetchSnippet,
  functionName,
  type RoqquCatalog,
  type RoqquEndpoint,
} from "./roqquCode";

const send: RoqquEndpoint = {
  id: "send-token",
  section: "Wallet",
  title: "Send Token",
  summary: "",
  method: "POST",
  path: "/user/send-{token}",
  auth: true,
  moves_money: true,
  paid_lookup: false,
  note: "",
  params: [
    { name: "token", in: "path", required: true, type: "string", default: "eth", description: "" },
    { name: "amount", in: "body", required: true, type: "number", default: 0.1, description: "" },
    { name: "wallet", in: "body", required: true, type: "string", default: "0xabc", description: "" },
    { name: "memo", in: "body", required: false, type: "string", default: "", description: "" },
  ],
  examples: {},
  doc_url: "https://developers.roqqu.com/reference/send-token-1",
};

const price: RoqquEndpoint = {
  ...send,
  id: "get-price",
  method: "GET",
  path: "/price",
  auth: false,
  moves_money: false,
  params: [{ name: "symbol", in: "query", required: true, type: "string", default: "btc", description: "" }],
};

const catalog: RoqquCatalog = {
  base_url: "https://api.roqqu.com/prod/v1",
  auth: "",
  endpoints: [price, send],
  webhook: { title: "", summary: "", payload: {}, note: "", doc_url: "" },
};

describe("roqquCode", () => {
  it("writes axios in the docs' shape, with path, typed body and bearer header", () => {
    const code = axiosSnippet(catalog, send, defaultValues(send));
    expect(code).toContain("url: 'https://api.roqqu.com/prod/v1/user/send-eth'");
    expect(code).toContain("amount: 0.1");
    expect(code).toContain("Authorization: `Bearer ${process.env.ROQQU_SECRET_KEY}`");
    expect(code).not.toContain("memo"); // empty optional params are left out
  });

  it("puts GET params in the query and leaves auth off public endpoints", () => {
    const code = axiosSnippet(catalog, price, { symbol: "trx" });
    expect(code).toContain("params: {\n    symbol: 'trx'\n  }");
    expect(code).not.toContain("Authorization");
    expect(fetchSnippet(catalog, price, { symbol: "trx" })).toContain("url.searchParams.set('symbol', 'trx');");
  });

  it("escapes quotes so user input cannot break the snippet", () => {
    const code = axiosSnippet(catalog, price, { symbol: "b'tc" });
    expect(code).toContain("symbol: 'b\\'tc'");
  });

  it("generates a runnable client with one method per endpoint", async () => {
    const source = clientModule(catalog);
    const sandbox = { module: { exports: {} as unknown }, URL, fetch: undefined as unknown };
    const calls: { url: string; init: RequestInit }[] = [];
    sandbox.fetch = async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => ({ status: "success", data: 42 }) };
    };
    vm.runInNewContext(source, sandbox);
    const factory = sandbox.module.exports as (key: string) => Record<string, (a?: object) => Promise<unknown>>;
    const roqqu = factory("RQ-SEC-k");
    expect(Object.keys(roqqu)).toEqual(["getPrice", "sendToken"]);
    expect(await roqqu.sendToken({ token: "trx", amount: 1, wallet: "T1" })).toBe(42);
    expect(calls[0].url).toBe("https://api.roqqu.com/prod/v1/user/send-trx");
    expect(calls[0].init.body).toBe(JSON.stringify({ amount: 1, wallet: "T1" }));
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer RQ-SEC-k");
  });

  it("names client methods in camelCase and shows how to call them", () => {
    expect(functionName("recharge-airtime")).toBe("rechargeAirtime");
    expect(clientSnippet(price, { symbol: "eth" })).toContain("roqqu.getPrice({\n  symbol: 'eth'\n})");
  });
});
