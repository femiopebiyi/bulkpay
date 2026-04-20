"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider as AdapterWalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { WalletProvider } from "@/context/WalletContext";
import { ToastProvider } from "@/context/ToastContext";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function Providers({ children }: { children: React.ReactNode }) {
    const endpoint = clusterApiUrl("devnet");

    // useMemo prevents wallets from being recreated on every render
    const wallets = useMemo(
        () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
        []
    );

    return (
        <ConnectionProvider endpoint={endpoint}>
            <AdapterWalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <WalletProvider>
                        <ToastProvider>
                            {children}
                        </ToastProvider>
                    </WalletProvider>
                </WalletModalProvider>
            </AdapterWalletProvider>
        </ConnectionProvider>
    );
}