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
  id: "send-coin",
  section: "Wallets",
  title: "Send Coin",
  summary: "",
  method: "POST",
  path: "/wallets/send",
  auth: true,
  moves_money: true,
  paid_lookup: false,
  note: "",
  params: [
    { name: "amount", in: "body", required: true, type: "integer", default: "2", description: "" },
    { name: "network", in: "body", required: true, type: "string", default: "trc20", description: "" },
    { name: "to", in: "body", required: true, type: "string", default: "TUyR2", description: "" },
    { name: "token", in: "body", required: true, type: "string", default: "usdt", description: "" },
    { name: "memo", in: "body", required: false, type: "string", default: "", description: "" },
  ],
  examples: {},
  doc_url: "https://roqqu-api-services.gitbook.io/ras/wallets/send-coin",
};

const status: RoqquEndpoint = {
  ...send,
  id: "get-transaction-status-by-transaction-hash",
  method: "GET",
  path: "/transaction/status/{tx_hash}",
  moves_money: false,
  params: [{ name: "tx_hash", in: "path", required: true, type: "string", default: "0xabc", description: "" }],
};

const prices: RoqquEndpoint = {
  ...send,
  id: "get-crypto-prices",
  method: "GET",
  path: "/prices",
  auth: false,
  moves_money: false,
  params: [{ name: "symbol", in: "query", required: false, type: "string", default: "", description: "" }],
};

const catalog: RoqquCatalog = {
  base_url: "https://service.roqqu.com/v1",
  auth: "",
  endpoints: [prices, send],
  webhook: { title: "", summary: "", payload: {}, note: "", doc_url: "" },
};

describe("roqquCode", () => {
  it("writes axios with a form body and the test-key header, like the RAS docs", () => {
    const code = axiosSnippet(catalog, send, defaultValues(send));
    expect(code).toContain("url: 'https://service.roqqu.com/v1/wallets/send'");
    expect(code).toContain("data: new URLSearchParams({");
    expect(code).toContain("amount: '2'"); // exact text, never a float
    expect(code).toContain("'x-staging-api-key': process.env.RAS_TEST_KEY");
    expect(code).toContain("'content-type': 'application/x-www-form-urlencoded'");
    expect(code).not.toContain("memo"); // empty optional params are left out
  });

  it("fills path params and leaves auth off public endpoints", () => {
    expect(fetchSnippet(catalog, status, { tx_hash: "0xdecc" })).toContain(
      "new URL('https://service.roqqu.com/v1/transaction/status/0xdecc')",
    );
    const code = axiosSnippet(catalog, prices, { symbol: "btc" });
    expect(code).toContain("params: {\n    symbol: 'btc'\n  }");
    expect(code).not.toContain("api-key");
  });

  it("escapes quotes so user input cannot break the snippet", () => {
    const code = axiosSnippet(catalog, prices, { symbol: "b'tc" });
    expect(code).toContain("symbol: 'b\\'tc'");
  });

  it("generates a runnable client with one method per endpoint", async () => {
    const source = clientModule(catalog);
    const sandbox = { module: { exports: {} as unknown }, URL, URLSearchParams, fetch: undefined as unknown };
    const calls: { url: string; init: RequestInit }[] = [];
    sandbox.fetch = async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => ({ status: "success", data: { refid: "42" } }) };
    };
    vm.runInNewContext(source, sandbox);
    const factory = sandbox.module.exports as (keys: object) => Record<string, (a?: object) => Promise<unknown>>;
    const roqqu = factory({ testKey: "ras_test_k" });
    expect(Object.keys(roqqu)).toEqual(["getCryptoPrices", "sendCoin"]);
    expect(await roqqu.sendCoin({ amount: 1, network: "trc20", to: "T1", token: "usdt" })).toEqual({ refid: "42" });
    expect(calls[0].url).toBe("https://service.roqqu.com/v1/wallets/send");
    expect(calls[0].init.body).toBe("amount=1&network=trc20&to=T1&token=usdt");
    expect((calls[0].init.headers as Record<string, string>)["x-staging-api-key"]).toBe("ras_test_k");
  });

  it("names client methods in camelCase and shows how to call them", () => {
    expect(functionName("generate-wallet-for-self")).toBe("generateWalletForSelf");
    expect(clientSnippet(prices, { symbol: "eth" })).toContain("roqqu.getCryptoPrices({\n  symbol: 'eth'\n})");
  });
});
