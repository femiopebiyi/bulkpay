"use client";
import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { useToast } from "@/context/ToastContext";
import { authHeaders } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function Profile({ onBack }: { onBack: () => void }) {
    const { profile, shortAddress, address, updateName, loadingProfile } = useWallet();
    const { addToast } = useToast();
    const [name,   setName]   = useState(profile.name);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (!name.trim()) {
            addToast("Name cannot be empty", "error");
            return;
        }

        setSaving(true);
        try {
            const res = await fetch(`${BASE}/users/me`, {
                method:  "PUT",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeaders(),
                },
                body: JSON.stringify({ display_name: name.trim() }),
            });

            if (!res.ok) throw new Error("Failed to save");

            // Update local context so navbar/dashboard reflect immediately
            updateName(name.trim());
            addToast("Display name updated", "success");
        } catch {
            addToast("Failed to save name — please try again", "error");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="animate-slide-up max-w-md">
            <button
                onClick={onBack}
                className="text-xs text-bp-muted hover:text-bp-dark mb-4 cursor-pointer"
            >
                ← Back
            </button>
            <h1 className="font-display text-xl sm:text-[22px] text-bp-dark tracking-tight">
                Profile
            </h1>
            <p className="text-xs text-bp-muted mb-5 mt-0.5">Your account details</p>

            {/* Wallet address */}
            <div className="bg-bp-dark rounded-lg p-4 mb-4">
                <div className="text-[10px] text-white/30 tracking-wide uppercase mb-2">
                    Connected wallet
                </div>
                <div className="font-mono text-sm text-white/80 break-all">{address}</div>
                <div className="font-mono text-[11px] text-bp-accent mt-1">{shortAddress}</div>
            </div>

            {/* Display name */}
            <div className="bg-white border border-bp-border rounded-lg p-4 mb-4">
                <div className="text-[11px] text-bp-hint tracking-wide uppercase mb-3">
                    Display name
                </div>
                <div className="flex gap-2 items-center">
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSave()}
                        placeholder="Your name"
                        className="flex-1 h-[34px] px-3 border border-gray-300 rounded-md text-[13px] font-body bg-white text-bp-dark placeholder:text-bp-hint"
                    />
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-bp-dark-btn text-white font-medium text-xs px-4 h-[34px] rounded-md hover:bg-bp-dark-btn-hover transition-all cursor-pointer flex-shrink-0 disabled:opacity-50"
                    >
                        {saving ? "Saving..." : "Save"}
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="bg-white border border-bp-border rounded-lg p-4">
                <div className="text-[11px] text-bp-hint tracking-wide uppercase mb-3">
                    All-time stats
                </div>
                <div className="space-y-3">
                    {[
                        { label: "Total sent",        value: loadingProfile ? "..." : `${profile.allTimeSent ?? "0"} USDC` },
                        { label: "Total batches",     value: loadingProfile ? "..." : String(profile.totalBatches ?? 0) },
                        { label: "Total recipients",  value: loadingProfile ? "..." : String(profile.totalRecipients ?? 0) },
                        { label: "Active schedules",  value: loadingProfile ? "..." : String(profile.activeSchedules ?? 0) },
                    ].map((item) => (
                        <div
                            key={item.label}
                            className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-b-0"
                        >
                            <span className="text-[12px] text-bp-muted">{item.label}</span>
                            <span className="font-mono text-[13px] font-medium text-bp-dark">
                                {item.value}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
