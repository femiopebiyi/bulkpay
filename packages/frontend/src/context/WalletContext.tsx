"use client";
import {
    createContext, useContext, useCallback, ReactNode, useState,
} from "react";
import { useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { UserProfile } from "@/lib/types";

interface WalletContextType {
    connected: boolean;
    address: string;
    shortAddress: string;
    profile: UserProfile;
    balance: number;
    connecting: boolean;
    connect: () => void;
    disconnect: () => void;
    updateName: (name: string) => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
    const { connected, publicKey, disconnect: adapterDisconnect, connecting } = useAdapterWallet();
    const { setVisible } = useWalletModal();

    const address = publicKey?.toBase58() ?? "";
    const shortAddress = address ? address.slice(0, 4) + "..." + address.slice(-4) : "";

    // Profile name is local — everything else comes from the adapter
    const [name, setName] = useState("My Wallet");

    const profile: UserProfile = {
        wallet: address,
        name,

    };

    const connect = useCallback(() => setVisible(true), [setVisible]);
    const disconnect = useCallback(() => adapterDisconnect(), [adapterDisconnect]);
    const updateName = useCallback((n: string) => setName(n), []);

    return (
        <WalletContext.Provider value={{
            connected,
            address,
            shortAddress,
            profile,
            balance: 0,       // replace with real RPC fetch when backend is ready
            connecting,
            connect,
            disconnect,
            updateName,
        }}>
            {children}
        </WalletContext.Provider>
    );
}

export function useWallet() {
    const ctx = useContext(WalletContext);
    if (!ctx) throw new Error("useWallet must be used within WalletProvider");
    return ctx;
}