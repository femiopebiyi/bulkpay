"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { mockMints } from "@/lib/mockData";
import { MintRecord } from "@/lib/types";

export default function Faucet() {
  const { shortAddress } = useWallet();
  const [mints, setMints] = useState<MintRecord[]>(mockMints);
  const [minting, setMinting] = useState(false);
  const [msg, setMsg] = useState("");

  const doMint = () => {
    setMinting(true);
    setMsg("");
    setTimeout(() => {
      setMints([{ wallet: shortAddress, amount: "10,000 USDC", when: "just now" }, ...mints]);
      setMsg(`10,000 USDC minted to ${shortAddress} · tx confirmed`);
      setMinting(false);
    }, 1200);
  };

  return (
    <div className="animate-slide-up">
      <h1 className="font-display text-xl sm:text-[22px] text-bp-dark tracking-tight">Devnet faucet</h1>
      <p className="text-xs text-bp-muted mb-4 mt-0.5">
        Mint test USDC to your connected wallet for testing BulkPay
      </p>

      {/* Mint card */}
      <div className="bg-bp-dark rounded-lg p-4 sm:p-5 mb-3">
        <div className="text-[10px] text-white/30 tracking-wide uppercase">Test USDC · per request</div>
        <div className="font-mono text-2xl sm:text-3xl font-medium text-bp-accent mt-2 mb-1">10,000 USDC</div>
        <div className="text-[11px] text-white/25 mb-3">1 request per wallet per day · devnet only</div>

        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-white/35 mb-1">Recipient</div>
            <div className="font-mono text-sm text-white/80">{shortAddress}</div>
            <div className="text-[10px] text-white/25 mt-0.5">Your connected wallet</div>
          </div>
          <button
            onClick={doMint}
            disabled={minting}
            className="bg-bp-accent text-bp-dark font-medium text-[13px] px-5 py-2 rounded-md
                       hover:bg-bp-accent-hover transition-all cursor-pointer
                       disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            {minting ? "Minting…" : "Mint →"}
          </button>
        </div>

        {msg && <div className="text-[11px] text-bp-accent mt-3">{msg}</div>}
      </div>

      {/* Mint history */}
      <div className="bg-white border border-bp-border rounded-lg overflow-hidden">
        <div className="flex items-center px-3 py-2 border-b border-bp-border-light
                        text-[11px] text-bp-hint tracking-wide uppercase">
          <div className="flex-1">Wallet</div>
          <div className="w-[110px]">Amount</div>
          <div className="w-[80px] text-right">When</div>
        </div>
        {mints.map((m, i) => (
          <div key={i} className="flex items-center px-3 py-2.5 border-b border-gray-50 last:border-b-0">
            <div className="flex-1 font-mono text-[11px] text-bp-muted">{m.wallet}</div>
            <div className="w-[110px] font-mono text-[11px] text-bp-muted">{m.amount}</div>
            <div className="w-[80px] text-right font-mono text-[11px] text-bp-hint">{m.when}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
