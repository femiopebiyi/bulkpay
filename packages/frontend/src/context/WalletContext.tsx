"use client";
import {
    createContext, useContext, useCallback,
    ReactNode, useState, useEffect,
} from "react";
import { useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { UserProfile } from "@/lib/types";
import { setJwt, clearJwt, getJwt } from "@/lib/auth";
import { fetchNonce, verifySignature, fetchUserProfile } from "@/lib/api";
import { fetchTokenBalance } from "@/lib/solana";

interface WalletContextType {
    connected:      boolean;
    address:        string;
    shortAddress:   string;
    profile:        UserProfile;
    balance:        number;
    connecting:     boolean;
    loadingProfile: boolean;
    authenticated:  boolean;
    connect:        () => void;
    disconnect:     () => void;
    updateName:     (name: string) => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

const emptyProfile = (wallet: string): UserProfile => ({
    wallet,
    name:            "My Wallet",
    allTimeSent:     "0",
    totalBatches:    0,
    totalRecipients: 0,
    activeSchedules: 0,
});

export function WalletProvider({ children }: { children: ReactNode }) {
    const {
        connected,
        publicKey,
        disconnect: adapterDisconnect,
        connecting,
        signMessage,
    } = useAdapterWallet();
    const { setVisible } = useWalletModal();

    const address      = publicKey?.toBase58() ?? "";
    const shortAddress = address
        ? `${address.slice(0, 4)}...${address.slice(-4)}`
        : "";

    const [profile,        setProfile] = useState<UserProfile>(emptyProfile(""));
    const [balance,        setBalance] = useState(0);
    const [loadingProfile, setLoading] = useState(false);
    const [authenticated,  setAuthed]  = useState(false);

    // ── Step 1: Sign nonce → get JWT when wallet connects ─────────────────────

    useEffect(() => {
        if (!connected || !address || !signMessage) {
            clearJwt();
            setAuthed(false);
            setProfile(emptyProfile(""));
            setBalance(0);
            return;
        }

        // Skip if already authenticated for this session
        if (getJwt()) {
            setAuthed(true);
            return;
        }

        let cancelled = false;

        async function authenticate() {
            setLoading(true);
            try {
                // Get nonce from backend
                const { message, nonce } = await fetchNonce(address);

                // Sign with wallet — one popup to user
                const encoded  = new TextEncoder().encode(message);
                const sigBytes = await signMessage!(encoded);

                // Encode signature as base58
                const bs58      = await import("bs58");
                const signature = bs58.default.encode(sigBytes);

                // Verify + get JWT
                const { token } = await verifySignature(address, nonce, signature);
                setJwt(token);

                if (!cancelled) setAuthed(true);
            } catch (err) {
                console.error("Authentication failed:", err);
                if (!cancelled) {
                    setLoading(false);
                    setAuthed(false);
                }
            }
        }

        authenticate();
        return () => { cancelled = true; };
    }, [connected, address, signMessage]);

    // ── Step 2: Load profile + balance once JWT is ready ─────────────────────

    useEffect(() => {
        if (!authenticated || !address) return;

        let cancelled = false;

        async function loadData() {
            try {
                // Both fetch in parallel
                const [profileData, balanceData] = await Promise.all([
                    fetchUserProfile(address),
                    fetchTokenBalance(address),
                ]);

                if (!cancelled) {
                    setProfile(profileData);
                    setBalance(balanceData);
                }
            } catch (err) {
                console.error("Failed to load wallet data:", err);
                if (!cancelled) setProfile(emptyProfile(address));
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        loadData();
        return () => { cancelled = true; };
    }, [authenticated, address]);

    const connect    = useCallback(() => setVisible(true), [setVisible]);
    const disconnect = useCallback(() => {
        adapterDisconnect();
        clearJwt();
        setAuthed(false);
        setProfile(emptyProfile(""));
        setBalance(0);
    }, [adapterDisconnect]);

    const updateName = useCallback(
        (name: string) => setProfile((p) => ({ ...p, name })),
        [],
    );

    return (
        <WalletContext.Provider value={{
            connected, address, shortAddress,
            profile, balance, connecting,
            loadingProfile, authenticated,
            connect, disconnect, updateName,
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
