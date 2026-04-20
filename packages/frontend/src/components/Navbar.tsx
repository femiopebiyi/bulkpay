"use client";
import { useState, useRef, useEffect } from "react";
import { useWallet } from "@/context/WalletContext";
import { Page } from "@/lib/types";

const NAV_ITEMS: { label: string; page: Page }[] = [
  { label: "Dashboard", page: "dashboard" },
  { label: "Send", page: "send" },
  { label: "History", page: "history" },
  { label: "Schedules", page: "schedules" },
  { label: "Faucet", page: "faucet" },
];

export default function Navbar({ activePage, onNavigate }: { activePage: Page; onNavigate: (p: Page) => void }) {
  const { shortAddress, disconnect } = useWallet();
  const [showPopup, setShowPopup] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setShowPopup(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <nav className="bg-bp-dark">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 flex items-center h-12 gap-1">
        <div className="flex items-center gap-1.5 mr-3 sm:mr-4 cursor-pointer flex-shrink-0" onClick={() => onNavigate("dashboard")}>
          <div className="w-[7px] h-[7px] rounded-full bg-bp-accent" />
          <span className="font-display text-[15px] sm:text-base text-white">BulkPay</span>
        </div>
        <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar flex-1 min-w-0">
          {NAV_ITEMS.map((item) => (
            <button key={item.page} onClick={() => onNavigate(item.page)}
              className={`text-xs px-2 sm:px-2.5 py-1 rounded whitespace-nowrap transition-colors cursor-pointer flex-shrink-0
                ${activePage === item.page ? "text-bp-accent" : "text-bp-muted hover:text-gray-300"}`}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="relative flex-shrink-0" ref={ref}>
          <button onClick={() => setShowPopup(!showPopup)}
            className="font-mono text-[11px] text-bp-hint bg-white/[0.06] px-2.5 py-1 rounded border border-white/10 hover:bg-white/[0.1] transition-colors cursor-pointer">
            {shortAddress}
          </button>
          {showPopup && (
            <div className="absolute right-0 top-full mt-1.5 w-40 bg-white border border-bp-border rounded-lg z-50 animate-fade-in overflow-hidden">
              <button onClick={() => { setShowPopup(false); onNavigate("profile"); }}
                className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">Profile</button>
              <div className="border-t border-bp-border-light" />
              <button onClick={() => { setShowPopup(false); disconnect(); }}
                className="w-full text-left px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 cursor-pointer">Disconnect</button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
