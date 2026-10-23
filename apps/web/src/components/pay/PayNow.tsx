/**
 * "Pay now": opens the buyer's browser wallet (MetaMask, Rabby, Trust...) on
 * BNB Smart Chain and sends exactly the USDT due to this invoice's Roqqu
 * deposit address. Roqqu then confirms the deposit and the page flips to paid.
 *
 * In Practice mode the deposit addresses are not real, so the wallet only
 * connects and the payment is simulated: no coins move.
 */
"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatUnits, parseUnits, type EIP1193Provider } from "viem";

import { BSC_CHAIN, BSC_EXPLORER, BSC_USDT, BSC_USDT_DECIMALS, ERC20_ABI } from "@/lib/biz/bsc";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

interface Props {
  invoiceId: string;
  usdtDue: string;
  bep20Address: string | null;
  otherWallets: { network: string; token: string; address: string }[];
  hostedLink: string | null;
  initialStatus: string;
  mode: "practice" | "test" | "live";
}

type Step =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "paying"; from: string }
  | { kind: "sent"; hash: string }
  | { kind: "error"; message: string };

function walletError(err: unknown): string {
  const e = err as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number } };
  if (e?.code === 4001 || e?.cause?.code === 4001 || /reject|denied/i.test(e?.message ?? "")) return "You cancelled in your wallet. Nothing was sent.";
  return e?.shortMessage ?? e?.message ?? "The wallet could not send the payment.";
}

async function switchToBsc(wallet: ReturnType<typeof createWalletClient>) {
  if ((await wallet.getChainId()) === BSC_CHAIN.id) return;
  try {
    await wallet.switchChain({ id: BSC_CHAIN.id });
  } catch (err) {
    const code = (err as { code?: number; cause?: { code?: number } }).code ?? (err as { cause?: { code?: number } }).cause?.code;
    if (code !== 4902) throw err;
    await wallet.addChain({ chain: BSC_CHAIN });
    await wallet.switchChain({ id: BSC_CHAIN.id });
  }
}

export function PayNow(props: Props) {
  const [status, setStatus] = useState(props.initialStatus);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [showOther, setShowOther] = useState(false);
  const paid = status === "paid" || status === "overpaid";

  // Roqqu's webhook marks the invoice paid; poll until it does.
  useEffect(() => {
    if (paid) return;
    const t = window.setInterval(async () => {
      const res = await fetch(`/api/pay/${props.invoiceId}`, { cache: "no-store" }).catch(() => null);
      const json = res?.ok ? await res.json() : null;
      if (json?.status) setStatus(json.status);
    }, 5000);
    return () => window.clearInterval(t);
  }, [paid, props.invoiceId]);

  async function pay() {
    if (!window.ethereum) {
      setStep({ kind: "error", message: "No browser wallet found. Install MetaMask (or open this page in your wallet's browser), or pay with BTC / Tron below." });
      return;
    }
    if (!props.bep20Address) {
      setStep({ kind: "error", message: "This invoice has no BNB Chain address. Pay with BTC / Tron below." });
      return;
    }
    setStep({ kind: "connecting" });
    try {
      const wallet = createWalletClient({ chain: BSC_CHAIN, transport: custom(window.ethereum) });
      const [from] = await wallet.requestAddresses();
      await switchToBsc(wallet);
      setStep({ kind: "paying", from });
      const amount = parseUnits(props.usdtDue, BSC_USDT_DECIMALS);

      if (props.mode === "practice") {
        // Practice: the wallet connected for real; the payment itself is simulated.
        const res = await fetch(`/api/pay/${props.invoiceId}/practice`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amount: props.usdtDue }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Practice payment failed");
        setStep({ kind: "sent", hash: "" });
        setStatus("paid");
        return;
      }

      const reader = createPublicClient({ chain: BSC_CHAIN, transport: custom(window.ethereum) });
      const balance = await reader.readContract({ address: BSC_USDT, abi: ERC20_ABI, functionName: "balanceOf", args: [from] });
      if (balance < amount) {
        throw new Error(`This wallet has ${formatUnits(balance, BSC_USDT_DECIMALS)} USDT on BNB Chain; you need ${props.usdtDue}.`);
      }
      const hash = await wallet.writeContract({
        account: from,
        chain: BSC_CHAIN,
        address: BSC_USDT,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [props.bep20Address as `0x${string}`, amount],
      });
      setStep({ kind: "sent", hash });
    } catch (err) {
      setStep({ kind: "error", message: walletError(err) });
    }
  }

  if (paid) {
    return (
      <div className="pp-paid" role="status">
        <span aria-hidden>✓</span>
        <div>
          <b>Paid. Confirmed by Roqqu.</b>
          <p>Thank you. The seller has been notified.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pp-pay">
      {status === "underpaid" ? (
        <p className="pp-warn">Roqqu received less than the total. Contact the seller to settle the rest.</p>
      ) : null}
      <button type="button" className="pp-btn" onClick={() => void pay()} disabled={step.kind === "connecting" || step.kind === "paying"}>
        {step.kind === "connecting" ? "Opening your wallet…" : step.kind === "paying" ? "Confirm in your wallet…" : `Pay now · ${props.usdtDue} USDT`}
      </button>
      <p className="pp-fine">
        Opens your browser wallet on BNB Chain (BEP20 USDT).
        {props.mode === "practice" ? " Practice mode: your wallet connects, but no coins move." : ""}
        {props.mode === "test" ? " Roqqu test mode." : ""}
      </p>

      {step.kind === "sent" ? (
        <p className="pp-ok" role="status">
          {step.hash ? (
            <>
              Sent. <a href={`${BSC_EXPLORER}/tx/${step.hash}`} target="_blank" rel="noopener noreferrer">View the transaction</a>.
              Waiting for Roqqu to confirm it…
            </>
          ) : (
            "Practice payment sent."
          )}
        </p>
      ) : null}
      {step.kind === "error" ? <p className="pp-err" role="alert">{step.message}</p> : null}

      <button type="button" className="pp-alt" onClick={() => setShowOther((v) => !v)} aria-expanded={showOther}>
        {showOther ? "Hide other ways to pay" : "Pay with BTC or USDT on Tron"}
      </button>
      {showOther ? (
        <div className="pp-other">
          {props.hostedLink ? (
            <a className="pp-btn pp-btn--ghost" href={props.hostedLink}>Open Roqqu checkout</a>
          ) : null}
          {props.otherWallets.map((w) => (
            <div key={w.network} className="pp-addr">
              <QRCodeSVG value={w.address} size={96} marginSize={1} />
              <div>
                <b>{w.token.toUpperCase()} on {w.network === "trc20" ? "Tron (TRC20)" : w.network === "bitcoin" ? "Bitcoin" : "BNB Chain (BEP20)"}</b>
                <code>{w.address}</code>
                <small>Send the naira total&apos;s worth; Roqqu converts at its live rate.</small>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
