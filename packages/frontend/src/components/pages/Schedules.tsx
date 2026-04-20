"use client";
import { useState } from "react";
import { useToast } from "@/context/ToastContext";
import { mockSchedules } from "@/lib/mockData";
import { ScheduleRecord } from "@/lib/types";

const statusStyle: Record<string, string> = { active: "bg-emerald-100 text-emerald-800", running: "bg-blue-100 text-blue-800", cancelled: "bg-red-100 text-red-800" };

export default function Schedules({ onNewSchedule }: { onNewSchedule: () => void }) {
  const [schedules, setSchedules] = useState<ScheduleRecord[]>(mockSchedules);
  const { addToast } = useToast();

  const cancelSchedule = (id: string) => {
    setSchedules(schedules.map((s) => s.id === id ? { ...s, status: "cancelled" as const } : s));
    addToast("Schedule cancelled — on-chain close_schedule will be sent", "info");
  };

  return (
    <div className="animate-slide-up">
      <h1 className="font-display text-xl sm:text-[22px] text-bp-dark tracking-tight">Schedules</h1>
      <p className="text-xs text-bp-muted mb-4 mt-0.5">Recurring and future-dated transfers · requires one-time delegation</p>
      <div className="bg-white border border-bp-border rounded-lg overflow-hidden">
        <div className="hidden sm:flex items-center px-3 py-2 border-b border-bp-border-light text-[11px] text-bp-hint tracking-wide uppercase">
          <div className="w-[22%]">Name</div><div className="w-[18%]">Recurrence</div><div className="w-[12%]">Next</div>
          <div className="w-[22%]">Progress</div><div className="w-[14%]">Status</div><div className="w-[12%]" />
        </div>
        {schedules.map((s) => {
          const progress = s.maxRuns > 0 ? (s.runsCompleted / s.maxRuns) * 100 : 100;
          const progressLabel = s.maxRuns > 0 ? `${s.runsCompleted}/${s.maxRuns}` : "\u221E";
          const isCancelled = s.status === "cancelled";
          return (
            <div key={s.id} className={`flex flex-col sm:flex-row sm:items-center px-3 py-2.5 border-b border-gray-50 last:border-b-0 gap-2 sm:gap-0 ${isCancelled ? "opacity-45" : ""}`}>
              <div className="sm:w-[22%] text-[13px] font-medium text-bp-dark min-w-0 truncate">
                {isCancelled ? <span className="line-through">{s.name}</span> : s.name}
              </div>
              <div className="sm:w-[18%] font-mono text-[11px] text-bp-muted">{s.recurrence}</div>
              <div className="sm:w-[12%] font-mono text-[11px] text-bp-muted">{isCancelled ? "—" : s.nextRun}</div>
              <div className="sm:w-[22%] flex items-center gap-2 pr-2">
                <div className="h-[3px] bg-gray-200 rounded-full flex-1 overflow-hidden">
                  <div className="h-full bg-bp-accent rounded-full" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-[11px] text-bp-muted whitespace-nowrap">{progressLabel}</span>
              </div>
              <div className="sm:w-[14%]">
                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium ${statusStyle[s.status]}`}>
                  <span className="w-1 h-1 rounded-full bg-current" />{s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                </span>
              </div>
              <div className="sm:w-[12%]">
                {!isCancelled && (
                  <button onClick={() => cancelSchedule(s.id)}
                    className="bg-bp-danger text-bp-danger-text text-[11px] px-2.5 py-1 rounded cursor-pointer hover:bg-red-900 transition-colors">Cancel</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <button onClick={onNewSchedule}
          className="bg-bp-accent text-bp-dark font-medium text-xs px-4 py-2 rounded-md hover:bg-bp-accent-hover transition-all active:scale-[0.98] cursor-pointer">+ New schedule</button>
      </div>
    </div>
  );
}
