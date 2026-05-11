"use client";
import { useState, useEffect } from "react";
import { useWallet } from "@/context/WalletContext";
import { useToast } from "@/context/ToastContext";
import { authHeaders } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface MintRecord {
  wallet: string;
  amount: number;
  tx_signature: string | null;
  created_at: string;
}

export default function Faucet() {
  const { shortAddress, address, authenticated } = useWallet();
  const { addToast } = useToast();
  const [mints, setMints] = useState<MintRecord[]>([]);
  const [minting, setMinting] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    fetch(`${BASE}/mint/history`)
      .then((r) => r.json())
      .then(setMints)
      .catch(console.error);
  }, [authenticated]);

  const doMint = async () => {
    if (!address) return;
    setMinting(true);
    try {
      const res = await fetch(`${BASE}/mint`, {
        method: "POST",
        headers: authHeaders(),
      });

      if (res.status === 429) {
        const text = await res.text();
        // Backend returns "cooldown:<hours>"
        const hours = text.split(":")[1] ?? "24";
        addToast(`You can mint again in ${hours} hour${hours === "1" ? "" : "s"}`, "error");
        return;
      }

      if (!res.ok) {
        const err = await res.text();
        addToast(err || "Mint failed", "error");
        return;
      }

      const data = await res.json();
      addToast(`10,000 USDC minted to ${shortAddress}`, "success");

      // Refresh history
      const histRes = await fetch(`${BASE}/mint/history`);
      const hist = await histRes.json();
      setMints(hist);

    } catch (err: any) {
      addToast(err?.message ?? "Mint failed", "error");
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="animate-slide-up">
      <h1 className="font-display text-xl sm:text-[22px] text-bp-dark tracking-tight">
        Devnet faucet
      </h1>
      <p className="text-xs text-bp-muted mb-4 mt-0.5">
        Mint test USDC to your connected wallet · once per 24 hours
      </p>

      <div className="bg-bp-dark rounded-lg p-4 sm:p-5 mb-3">
        <div className="text-[10px] text-white/30 tracking-wide uppercase">
          Test USDC · per request
        </div>
        <div className="font-mono text-2xl sm:text-3xl font-medium text-bp-accent mt-2 mb-1">
          10,000 USDC
        </div>
        <div className="text-[11px] text-white/25 mb-3">
          1 request per wallet per day · devnet only
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-white/35 mb-1">Recipient</div>
            <div className="font-mono text-sm text-white/80">{shortAddress}</div>
            <div className="text-[10px] text-white/25 mt-0.5">Your connected wallet</div>
          </div>
          <button
            onClick={doMint}
            disabled={minting}
            className="bg-bp-accent text-bp-dark font-medium text-[13px] px-5 py-2 rounded-md hover:bg-bp-accent-hover transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            {minting ? "Minting…" : "Mint →"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-bp-border rounded-lg overflow-hidden">
        <div className="flex items-center px-3 py-2 border-b border-bp-border-light text-[11px] text-bp-hint tracking-wide uppercase">
          <div className="flex-1">Wallet</div>
          <div className="w-[110px]">Amount</div>
          <div className="w-[80px] text-right">When</div>
        </div>
        {mints.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-bp-muted">
            No mints yet
          </div>
        ) : (
          mints.map((m, i) => (
            <div key={i} className="flex items-center px-3 py-2.5 border-b border-gray-50 last:border-b-0">
              <div className="flex-1 font-mono text-[11px] text-bp-muted">
                {m.wallet.slice(0, 4)}...{m.wallet.slice(-4)}
              </div>
              <div className="w-[110px] font-mono text-[11px] text-bp-muted">
                {(m.amount / 1_000_000).toLocaleString()} USDC
              </div>
              <div className="w-[80px] text-right font-mono text-[11px] text-bp-hint">
                {new Date(m.created_at).toLocaleDateString("en-GB", {
                  day: "numeric", month: "short",
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}