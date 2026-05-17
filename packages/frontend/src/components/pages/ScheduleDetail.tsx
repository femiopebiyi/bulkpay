"use client";
import { ScheduleRecord } from "@/lib/types";

const statusStyle: Record<string, string> = {
    pending:   "bg-amber-100 text-amber-800",
    running:   "bg-blue-100 text-blue-800",
    confirmed: "bg-emerald-100 text-emerald-800",
    failed:    "bg-red-100 text-red-800",
    cancelled: "bg-gray-100 text-gray-500",
};

interface Props {
    schedule: ScheduleRecord;
    onBack:   () => void;
}

export default function ScheduleDetail({ schedule, onBack }: Props) {
    const progress = schedule.max_runs > 0
        ? (schedule.runs_completed / schedule.max_runs) * 100
        : 100;
    const progressLabel = schedule.max_runs > 0
        ? `${schedule.runs_completed} / ${schedule.max_runs} runs`
        : `${schedule.runs_completed} runs (unlimited)`;

    const totalPerRun = schedule.recipients.reduce((s, r) => s + r.amount, 0) / 1_000_000;

    return (
        <div className="animate-slide-up">
            <button onClick={onBack}
                className="flex items-center gap-1.5 text-[12px] text-bp-muted hover:text-bp-dark mb-4 cursor-pointer transition-colors">
                ← Back to schedules
            </button>

            <div className="flex items-start justify-between mb-4">
                <div>
                    <h1 className="font-display text-xl text-bp-dark tracking-tight capitalize">
                        {schedule.recurrence} schedule
                    </h1>
                    <p className="text-xs text-bp-muted mt-0.5">
                        Created {new Date(schedule.created_at).toLocaleDateString("en-GB", {
                            day: "numeric", month: "short", year: "numeric"
                        })}
                    </p>
                </div>
                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded font-medium ${statusStyle[schedule.status] ?? statusStyle.pending}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {schedule.status.charAt(0).toUpperCase() + schedule.status.slice(1)}
                </span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {[
                    { label: "Next run",    value: schedule.status === "cancelled" || schedule.status === "failed" ? "—"
                        : new Date(schedule.scheduled_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) },
                    { label: "Per run",     value: `${totalPerRun.toLocaleString()} USDC` },
                    { label: "Recipients",  value: String(schedule.recipients.length) },
                    { label: "Recurrence",  value: schedule.recurrence.charAt(0).toUpperCase() + schedule.recurrence.slice(1) },
                ].map((s) => (
                    <div key={s.label} className="bg-white border border-bp-border rounded-lg p-3">
                        <div className="text-[10px] text-bp-hint uppercase tracking-wide mb-1">{s.label}</div>
                        <div className="font-mono text-[13px] font-medium text-bp-dark">{s.value}</div>
                    </div>
                ))}
            </div>

            {/* Progress */}
            <div className="bg-white border border-bp-border rounded-lg p-3.5 mb-3">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-[11px] text-bp-hint uppercase tracking-wide">Progress</span>
                    <span className="text-[12px] font-mono text-bp-muted">{progressLabel}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-bp-accent rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(progress, 100)}%` }} />
                </div>
            </div>

            {/* Last tx */}
            {schedule.tx_signature && (
                <div className="bg-white border border-bp-border rounded-lg p-3.5 mb-3">
                    <div className="text-[11px] text-bp-hint uppercase tracking-wide mb-2">Last transaction</div>
                    <a href={`https://explorer.solana.com/tx/${schedule.tx_signature}?cluster=devnet`}
                        target="_blank" rel="noopener noreferrer"
                        className="font-mono text-[11px] text-blue-600 hover:underline break-all">
                        {schedule.tx_signature} ↗
                    </a>
                    {schedule.confirmed_at && (
                        <div className="text-[11px] text-bp-hint mt-1">
                            Confirmed {new Date(schedule.confirmed_at).toLocaleDateString("en-GB", {
                                day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Error */}
            {schedule.last_error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 mb-3">
                    <div className="text-[11px] text-red-700 uppercase tracking-wide mb-1">Last error</div>
                    <div className="text-[12px] text-red-600 font-mono">{schedule.last_error}</div>
                </div>
            )}

            {/* Recipients */}
            <div className="bg-white border border-bp-border rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-bp-border-light text-[11px] text-bp-hint uppercase tracking-wide">
                    Recipients ({schedule.recipients.length})
                </div>
                {schedule.recipients.map((r, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2.5 border-b border-gray-50 last:border-b-0">
                        <div className="min-w-0">
                            {r.name && (
                                <div className="text-[13px] font-medium text-bp-dark">{r.name}</div>
                            )}
                            <div className="font-mono text-[11px] text-bp-muted truncate">
                                {r.wallet.slice(0, 6)}...{r.wallet.slice(-6)}
                            </div>
                            {r.description && (
                                <div className="text-[11px] text-bp-hint">{r.description}</div>
                            )}
                        </div>
                        <div className="font-mono text-[12px] text-bp-dark flex-shrink-0 ml-4">
                            {(r.amount / 1_000_000).toLocaleString()} USDC
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}