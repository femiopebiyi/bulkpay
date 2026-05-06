"use client";
import { useState, useEffect } from "react";
import { useWallet } from "@/context/WalletContext";
import { useToast } from "@/context/ToastContext";
import { ScheduleRecord } from "@/lib/types";
import { fetchSchedules } from "@/lib/api";
import { authHeaders } from "@/lib/auth";

const statusStyle: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  running: "bg-blue-100 text-blue-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-500",
};

function formatNextRun(scheduledAt: string, status: string): string {
  if (status === "cancelled" || status === "failed") return "—";
  return new Date(scheduledAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function Schedules({ onNewSchedule }: { onNewSchedule: () => void }) {
  const { authenticated } = useWallet();
  const { addToast } = useToast();
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    setLoading(true);
    fetchSchedules()
      .then((data: any[]) => {
        const mapped: ScheduleRecord[] = data.map((s: any) => ({
          id: s.id,
          schedule_pda: s.schedule_pda,
          created_at_seed: s.created_at_seed ?? null,
          mint_address: s.mint_address,
          recipients: s.recipients ?? [],
          recurrence: s.recurrence,
          scheduled_at: s.scheduled_at,
          status: s.status,
          runs_completed: s.runs_completed,
          max_runs: s.max_runs,
          last_error: s.last_error ?? null,
          tx_signature: s.tx_signature ?? null,
          created_at: s.created_at,
          confirmed_at: s.confirmed_at ?? null,
        }));
        setSchedules(mapped);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [authenticated]);

  const cancelSchedule = async (id: string) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/schedules/${id}`,
        { method: "DELETE", headers: authHeaders() }
      );
      if (!res.ok) throw new Error("Cancel failed");
      setSchedules((prev) =>
        prev.map((s) => s.id === id ? { ...s, status: "cancelled" as const } : s)
      );
      addToast("Schedule cancelled", "success");
    } catch {
      addToast("Failed to cancel schedule", "error");
    }
  };

  return (
    <div className="animate-slide-up">
      <h1 className="font-display text-xl sm:text-[22px] text-bp-dark tracking-tight">Schedules</h1>
      <p className="text-xs text-bp-muted mb-4 mt-0.5">
        Recurring and future-dated transfers · requires one-time delegation
      </p>

      <div className="bg-white border border-bp-border rounded-lg overflow-hidden">
        <div className="hidden sm:flex items-center px-3 py-2 border-b border-bp-border-light text-[11px] text-bp-hint tracking-wide uppercase">
          <div className="w-[20%]">Recurrence</div>
          <div className="w-[22%]">Next run</div>
          <div className="w-[20%]">Progress</div>
          <div className="w-[18%]">Status</div>
          <div className="w-[20%]" />
        </div>

        {loading ? (
          <div className="px-3 py-6 text-center text-[13px] text-bp-muted">
            Loading schedules...
          </div>
        ) : schedules.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-bp-muted">
            No schedules yet — create one above
          </div>
        ) : (
          schedules.map((s) => {
            const isCancelled = s.status === "cancelled";
            const progress = s.max_runs > 0
              ? (s.runs_completed / s.max_runs) * 100
              : 100;
            const progressLabel = s.max_runs > 0
              ? `${s.runs_completed}/${s.max_runs}`
              : `${s.runs_completed}/∞`;

            return (
              <div key={s.id}
                className={`flex flex-col sm:flex-row sm:items-center px-3 py-2.5 border-b border-gray-50 last:border-b-0 gap-2 sm:gap-0 ${isCancelled ? "opacity-45" : ""}`}>
                <div className="sm:w-[20%] font-mono text-[11px] text-bp-muted capitalize">
                  {s.recurrence}
                </div>
                <div className="sm:w-[22%] font-mono text-[11px] text-bp-muted">
                  {formatNextRun(s.scheduled_at, s.status)}
                </div>
                <div className="sm:w-[20%] flex items-center gap-2 pr-2">
                  <div className="h-[3px] bg-gray-200 rounded-full flex-1 overflow-hidden">
                    <div className="h-full bg-bp-accent rounded-full"
                      style={{ width: `${Math.min(progress, 100)}%` }} />
                  </div>
                  <span className="text-[11px] text-bp-muted whitespace-nowrap">
                    {progressLabel}
                  </span>
                </div>
                <div className="sm:w-[18%]">
                  <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium ${statusStyle[s.status] ?? statusStyle.pending}`}>
                    <span className="w-1 h-1 rounded-full bg-current" />
                    {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                  </span>
                </div>
                <div className="sm:w-[20%] flex gap-2">
                  {!isCancelled && (
                    <button onClick={() => cancelSchedule(s.id)}
                      className="text-[11px] px-2.5 py-1 rounded cursor-pointer bg-red-900 text-red-100 hover:bg-red-800 transition-colors">
                      Cancel
                    </button>
                  )}
                  {s.tx_signature && (
                    <a href={`https://explorer.solana.com/tx/${s.tx_signature}?cluster=devnet`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-[11px] px-2.5 py-1 rounded bg-gray-100 text-bp-muted hover:bg-gray-200 transition-colors">
                      Tx ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3">
        <button onClick={onNewSchedule}
          className="bg-bp-accent text-bp-dark font-medium text-xs px-4 py-2 rounded-md hover:bg-bp-accent-hover transition-all active:scale-[0.98] cursor-pointer">
          + New schedule
        </button>
      </div>
    </div>
  );
}