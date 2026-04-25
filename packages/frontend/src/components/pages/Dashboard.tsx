"use client";
import { useState, useEffect } from "react";
import { useWallet } from "@/context/WalletContext";
import { Page, BatchRecord } from "@/lib/types";
import { fetchBatches } from "@/lib/api";

const badge: Record<string, string> = {
    confirmed: "bg-emerald-100 text-emerald-800",
    pending: "bg-amber-100 text-amber-800",
    submitted: "bg-blue-100 text-blue-800",
    failed: "bg-red-100 text-red-800",
};
const label: Record<string, string> = {
    confirmed: "Confirmed",
    pending: "Pending",
    submitted: "Submitted",
    failed: "Failed",
};

export default function Dashboard({ onNavigate, onOpenBatch, onNewSchedule }: {
    onNavigate: (p: Page) => void;
    onOpenBatch: (b: BatchRecord) => void;
    onNewSchedule: () => void;
}) {
    const { profile, balance, authenticated, loadingProfile } = useWallet();
    const [batches, setBatches] = useState<BatchRecord[]>([]);
    const [loadingBatch, setLoadingBatch] = useState(false);

    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    // Fetch real batches once authenticated
    useEffect(() => {
        if (!authenticated) return;

        setLoadingBatch(true);
        fetchBatches()
            .then((data) => {
                // Map backend shape to frontend BatchRecord shape
                const mapped: BatchRecord[] = data.map((b: any) => ({
                    id: b.id,
                    title: b.notes ?? "Batch transfer",
                    date: new Date(b.created_at).toLocaleDateString("en-GB", {
                        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                    }),
                    recipientCount: b.recipient_count,
                    total: (b.total_amount / 1_000_000).toLocaleString(),
                    status: b.status,
                    txSignatures: b.tx_signature ? [b.tx_signature] : [],
                    recipients: [],
                }));
                setBatches(mapped);
            })
            .catch(console.error)
            .finally(() => setLoadingBatch(false));
    }, [authenticated]);

    return (
        <div className="animate-slide-up">
            <h1 className="font-display text-xl sm:text-[22px] text-bp-dark tracking-tight">
                {greeting}, {profile.name}
            </h1>
            <p className="text-xs text-bp-muted mb-4 mt-0.5">USDC on Solana · Devnet</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5 mb-4">
                {[
                    { label: "Balance", value: loadingProfile ? "..." : balance.toLocaleString(), unit: "USDC" },
                    { label: "All-time sent", value: loadingProfile ? "..." : (profile.allTimeSent ?? "0"), unit: "USDC" },
                    { label: "Active schedules", value: loadingProfile ? "..." : String(profile.activeSchedules ?? 0), unit: "running" },
                    { label: "Total recipients", value: loadingProfile ? "..." : String(profile.totalRecipients ?? 0), unit: "sent to" },
                ].map((s) => (
                    <div key={s.label} className="bg-bp-dark rounded-lg p-3 sm:p-3.5">
                        <div className="text-[10px] text-bp-muted tracking-wide uppercase mb-1.5">
                            {s.label}
                        </div>
                        <div className="font-mono text-lg sm:text-xl font-medium text-white">
                            {s.value}{" "}
                            <span className="text-bp-accent text-[11px]">{s.unit}</span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex gap-2 mb-4">
                <button
                    onClick={() => onNavigate("send")}
                    className="bg-bp-accent text-bp-dark font-medium text-xs px-4 py-2 rounded-md hover:bg-bp-accent-hover transition-all active:scale-[0.98] cursor-pointer"
                >
                    + New batch
                </button>
                <button
                    onClick={onNewSchedule}
                    className="bg-bp-dark-btn text-white font-medium text-xs px-4 py-2 rounded-md hover:bg-bp-dark-btn-hover transition-all cursor-pointer"
                >
                    New schedule
                </button>
            </div>

            <div className="bg-white border border-bp-border rounded-lg overflow-hidden">
                <div className="flex items-center px-3 py-2 border-b border-bp-border-light text-[11px] text-bp-hint tracking-wide uppercase">
                    <div className="w-[45%] sm:w-[40%]">Batch</div>
                    <div className="w-[15%] text-center">Recip.</div>
                    <div className="w-[20%]">Total</div>
                    <div className="w-[20%] sm:w-[25%]">Status</div>
                </div>

                {loadingBatch ? (
                    <div className="px-3 py-6 text-center text-[13px] text-bp-muted">
                        Loading batches...
                    </div>
                ) : batches.length === 0 ? (
                    <div className="px-3 py-6 text-center text-[13px] text-bp-muted">
                        No batches yet — send your first batch above
                    </div>
                ) : (
                    batches.slice(0, 10).map((b) => (
                        <div
                            key={b.id}
                            onClick={() => onOpenBatch(b)}
                            className="flex items-center px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer last:border-b-0"
                        >
                            <div className="w-[45%] sm:w-[40%] min-w-0">
                                <div className="text-[13px] font-medium text-bp-dark truncate">{b.title}</div>
                                <div className="font-mono text-[11px] text-bp-muted">{b.date}</div>
                            </div>
                            <div className="w-[15%] text-center text-[13px] text-bp-dark">
                                {b.recipientCount}
                            </div>
                            <div className="w-[20%] font-mono text-[11px] text-bp-muted">
                                {b.total} USDC
                            </div>
                            <div className="w-[20%] sm:w-[25%]">
                                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium ${badge[b.status] || badge.pending}`}>
                                    <span className="w-1 h-1 rounded-full bg-current" />
                                    {label[b.status] || b.status}
                                </span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
