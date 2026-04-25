"use client";
import {
    createContext, useContext, useCallback,
    useEffect, useState, ReactNode,
} from "react";
import { useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { UserProfile } from "@/lib/types";
import { fetchTokenBalance } from "@/lib/solana";
import { fetchNonce, verifySignature, fetchUserProfile } from "@/lib/api";
import { setJwt, clearJwt, getJwt } from "@/lib/auth";

interface WalletContextType {
    connected: boolean;
    authenticated: boolean;       // true after JWT obtained
    connecting: boolean;
    address: string;
    shortAddress: string;
    profile: UserProfile;
    balance: number;
    loadingProfile: boolean;
    connect: () => void;
    disconnect: () => void;
    updateName: (name: string) => void;
    refreshBalance: () => Promise<void>;
    refreshProfile: () => Promise<void>;
}

const DEFAULT_PROFILE: UserProfile = {
    name: "Stranger",
    wallet: "",
    allTimeSent: "0",
    totalBatches: 0,
    totalRecipients: 0,
    activeSchedules: 0,
};

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
    const {
        connected,
        connecting,
        publicKey,
        signMessage,
        disconnect: adapterDisconnect,
    } = useAdapterWallet();
    const { setVisible } = useWalletModal();

    const address = publicKey?.toBase58() ?? "";
    const shortAddress = address ? address.slice(0, 4) + "..." + address.slice(-4) : "";

    const [authenticated, setAuthenticated] = useState(false);
    const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
    const [balance, setBalance] = useState(0);
    const [loadingProfile, setLoadingProfile] = useState(false);

    // ── Auth flow — runs once when wallet connects ────────────────────────────
    useEffect(() => {
        if (!connected || !publicKey || !signMessage) return;

        // If already have a JWT from a previous render cycle, skip re-auth
        if (getJwt()) { setAuthenticated(true); return; }

        let cancelled = false;

        const authenticate = async () => {
            try {
                // 1. Get nonce from backend
                const { message, nonce } = await fetchNonce(address);

                // 2. Sign the message in the wallet (silent — no popup on reconnect)
                const encodedMessage = new TextEncoder().encode(message);
                const signatureBytes = await signMessage(encodedMessage);

                if (cancelled) return;

                // 3. Convert signature to base58 and verify with backend
                const bs58 = await import("bs58");
                const signatureB58 = bs58.default.encode(signatureBytes);

                const { token } = await verifySignature(address, nonce, signatureB58);

                if (cancelled) return;

                setJwt(token);
                setAuthenticated(true);
            } catch (err) {
                console.error("Auth failed:", err);
                // Don't block the UI — user can retry by reconnecting
            }
        };

        // Near the top of authenticate()
        if (!signMessage) {
            console.warn("Wallet does not support signMessage — skipping auth");
            return;
        }

        authenticate();
        return () => { cancelled = true; };
    }, [connected, publicKey, signMessage, address]);

    // ── Fetch profile once authenticated ──────────────────────────────────────
    useEffect(() => {
        if (!authenticated || !address) return;

        setLoadingProfile(true);
        fetchUserProfile(address)
            .then(setProfile)
            .catch(console.error)
            .finally(() => setLoadingProfile(false));
    }, [authenticated, address]);

    // ── Fetch token balance once authenticated ────────────────────────────────
    const refreshBalance = useCallback(async () => {
        if (!address) { setBalance(0); return; }
        try {
            const bal = await fetchTokenBalance(address);
            setBalance(bal);
        } catch {
            setBalance(0);
        }
    }, [address]);

    // Add the function alongside refreshBalance
    const refreshProfile = useCallback(async () => {
        if (!address) return;
        try {
            const updated = await fetchUserProfile(address);
            setProfile(updated);
        } catch {
            console.error("Failed to refresh profile");
        }
    }, [address]);

    useEffect(() => {
        if (!authenticated) return;
        refreshBalance();
    }, [authenticated, refreshBalance]);

    // ── Connect / disconnect ──────────────────────────────────────────────────
    const connect = useCallback(() => setVisible(true), [setVisible]);

    const disconnect = useCallback(() => {
        adapterDisconnect();
        clearJwt();
        setAuthenticated(false);
        setProfile(DEFAULT_PROFILE);
        setBalance(0);
    }, [adapterDisconnect]);

    const updateName = useCallback((name: string) => {
        setProfile((p) => ({ ...p, name }));
    }, []);

    return (
        <WalletContext.Provider value={{
            connected,
            authenticated,
            connecting,
            address,
            shortAddress,
            profile,
            balance,
            loadingProfile,
            connect,
            disconnect,
            updateName,
            refreshBalance,
            refreshProfile,
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