/**
 * Where "Pay now" sends USDT: BNB Smart Chain, the network RAS payment links
 * call bep20. Browser-safe (no secrets). Mainnet by default; set
 * NEXT_PUBLIC_BSC_NETWORK=testnet (and optionally NEXT_PUBLIC_BSC_USDT) to
 * point the button at BSC testnet while testing.
 */
import { bsc, bscTestnet } from "viem/chains";

const testnet = process.env.NEXT_PUBLIC_BSC_NETWORK === "testnet";

export const BSC_CHAIN = testnet ? bscTestnet : bsc;

/** BEP20 USDT. Mainnet: Binance-Peg USDT. Testnet has no official USDT, so it is configurable. */
export const BSC_USDT = (process.env.NEXT_PUBLIC_BSC_USDT ||
  (testnet ? "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" : "0x55d398326f99059fF775485246999027B3197955")) as `0x${string}`;

/** BEP20 USDT uses 18 decimals (unlike 6 on Ethereum and Tron). */
export const BSC_USDT_DECIMALS = 18;

export const BSC_EXPLORER = testnet ? "https://testnet.bscscan.com" : "https://bscscan.com";

export const ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
