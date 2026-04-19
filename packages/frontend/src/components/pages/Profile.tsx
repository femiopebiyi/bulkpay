"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";

interface Props {
  onBack: () => void;
}

export default function Profile({ onBack }: Props) {
  const { profile, shortAddress, address, updateName } = useWallet();
  const [name, setName] = useState(profile.name);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    updateName(name);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="animate-slide-up max-w-md">
      <button
        onClick={onBack}
        className="text-xs text-bp-muted hover:text-bp-dark mb-4 cursor-pointer"
      >
        ← Back
      </button>

      <h1 className="font-display text-xl sm:text-[22px] text-bp-dark tracking-tight">Profile</h1>
      <p className="text-xs text-bp-muted mb-5 mt-0.5">Your account details</p>

      {/* Wallet card */}
      <div className="bg-bp-dark rounded-lg p-4 mb-4">
        <div className="text-[10px] text-white/30 tracking-wide uppercase mb-2">Connected wallet</div>
        <div className="font-mono text-sm text-white/80 break-all">{address}</div>
        <div className="font-mono text-[11px] text-bp-accent mt-1">{shortAddress}</div>
      </div>

      {/* Edit name */}
      <div className="bg-white border border-bp-border rounded-lg p-4 mb-4">
        <div className="text-[11px] text-bp-hint tracking-wide uppercase mb-3">Display name</div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="flex-1 h-[34px] px-3 border border-gray-300 rounded-md text-[13px]
                       font-body bg-white text-bp-dark placeholder:text-bp-hint"
          />
          <button
            onClick={handleSave}
            className="bg-bp-dark-btn text-white font-medium text-xs px-4 h-[34px] rounded-md
                       hover:bg-bp-dark-btn-hover transition-all cursor-pointer flex-shrink-0"
          >
            {saved ? "Saved" : "Save"}
          </button>
        </div>
        {saved && (
          <div className="text-[11px] text-emerald-600 mt-2 animate-fade-in">
            Name updated successfully
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="bg-white border border-bp-border rounded-lg p-4">
        <div className="text-[11px] text-bp-hint tracking-wide uppercase mb-3">All-time stats</div>
        <div className="space-y-3">
          {[
            { label: "Total sent", value: `${profile.allTimeSent} USDC` },
            { label: "Total batches", value: String(profile.totalBatches) },
            { label: "Total recipients", value: String(profile.totalRecipients) },
            { label: "Active schedules", value: String(profile.activeSchedules) },
          ].map((item) => (
            <div key={item.label} className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-b-0">
              <span className="text-[12px] text-bp-muted">{item.label}</span>
              <span className="font-mono text-[13px] font-medium text-bp-dark">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
