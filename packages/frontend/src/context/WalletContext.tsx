"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { mockProfile } from "@/lib/mockData";
import { UserProfile } from "@/lib/types";

interface WalletContextType {
  connected: boolean;
  address: string;
  shortAddress: string;
  profile: UserProfile;
  connect: () => void;
  disconnect: () => void;
  updateName: (name: string) => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(mockProfile);

  const address = profile.wallet;
  const shortAddress = address.slice(0, 4) + "..." + address.slice(-4);

  const connect = useCallback(() => setConnected(true), []);
  const disconnect = useCallback(() => setConnected(false), []);
  const updateName = useCallback(
    (name: string) => setProfile((p) => ({ ...p, name })),
    []
  );

  return (
    <WalletContext.Provider
      value={{ connected, address, shortAddress, profile, connect, disconnect, updateName }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
