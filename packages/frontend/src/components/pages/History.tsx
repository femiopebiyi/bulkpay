"use client";
import { BatchRecord } from "@/lib/types";
import { mockBatches } from "@/lib/mockData";

const badge: Record<string, string> = { confirmed: "bg-emerald-100 text-emerald-800", pending: "bg-amber-100 text-amber-800", submitted: "bg-blue-100 text-blue-800", failed: "bg-red-100 text-red-800" };
const label: Record<string, string> = { confirmed: "Confirmed", pending: "Pending", submitted: "Submitted", failed: "Failed" };

export default function History({ onOpenBatch }: { onOpenBatch: (b: BatchRecord) => void }) {
  return (
    <div className="animate-slide-up">
      <h1 className="font-display text-xl sm:text-[22px] text-bp-dark tracking-tight">History</h1>
      <p className="text-xs text-bp-muted mb-4 mt-0.5">All confirmed and pending batches</p>
      <div className="bg-white border border-bp-border rounded-lg overflow-hidden">
        <div className="hidden sm:flex items-center px-3 py-2 border-b border-bp-border-light text-[11px] text-bp-hint tracking-wide uppercase">
          <div className="w-[35%]">Batch</div><div className="w-[10%] text-center">Recip.</div>
          <div className="w-[18%]">Total</div><div className="w-[17%]">Status</div><div className="w-[20%]">Tx signature</div>
        </div>
        {mockBatches.map((b) => (
          <div key={b.id} onClick={() => onOpenBatch(b)}
            className="flex flex-col sm:flex-row sm:items-center px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer last:border-b-0 gap-1 sm:gap-0">
            <div className="sm:w-[35%] min-w-0">
              <div className="text-[13px] font-medium text-bp-dark truncate">{b.title}</div>
              <div className="font-mono text-[11px] text-bp-muted">{b.date}</div>
            </div>
            <div className="hidden sm:block sm:w-[10%] text-center text-[13px] text-bp-dark">{b.recipientCount}</div>
            <div className="sm:w-[18%]">
              <span className="font-mono text-[11px] text-bp-muted">{b.total} USDC</span>
              <span className="sm:hidden text-[11px] text-bp-muted"> · {b.recipientCount} recip.</span>
            </div>
            <div className="sm:w-[17%]">
              <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium ${badge[b.status] || badge.pending}`}>
                <span className="w-1 h-1 rounded-full bg-current" />{label[b.status] || b.status}
              </span>
            </div>
            <div className="sm:w-[20%] font-mono text-[10px] text-bp-hint">{b.txSignatures[0] || "—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
