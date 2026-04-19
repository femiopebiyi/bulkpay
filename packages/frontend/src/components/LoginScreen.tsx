"use client";

import { useWallet } from "@/context/WalletContext";

export default function LoginScreen() {
  const { connect } = useWallet();

  return (
    <div className="min-h-screen bg-bp-bg flex items-center justify-center px-4">
      <div className="text-center animate-fade-in">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-3 h-3 rounded-full bg-bp-accent" />
          <span className="font-display text-3xl sm:text-4xl text-bp-dark tracking-tight">
            BulkPay
          </span>
        </div>
        <p className="text-bp-muted text-sm mb-8 max-w-xs mx-auto leading-relaxed">
          Send USDC to multiple wallets in one transaction on Solana
        </p>
        <button
          onClick={connect}
          className="bg-bp-dark text-bp-accent font-body font-medium text-sm
                     px-8 py-3 rounded-lg hover:bg-bp-dark-btn-hover
                     transition-all active:scale-[0.98] cursor-pointer"
        >
          Connect wallet
        </button>
        <p className="text-xs text-bp-hint mt-4">Devnet · Phantom, Backpack, Solflare</p>
      </div>
    </div>
  );
}
