"use client";
import { useState, useEffect } from "react";
import { BatchRecord, BatchRecipient } from "@/lib/types";
import { fetchBatchDetail } from "@/lib/api";

const sBadge: Record<string, string> = {
  confirmed: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  submitted: "bg-blue-100 text-blue-800",
  failed: "bg-red-100 text-red-800",
};
const sLabel: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  submitted: "Submitted",
  failed: "Failed",
};
const INITIAL_SHOW = 5;

export default function BatchDetail({ batch, onBack }: { batch: BatchRecord; onBack: () => void }) {
  const [recipients, setRecipients] = useState<BatchRecipient[]>(batch.recipients);
  const [loading, setLoading] = useState(batch.recipients.length === 0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (batch.recipients.length > 0) return; // already populated

    setLoading(true);
    fetchBatchDetail(batch.id)
      .then((data: any) => {
        const mapped: BatchRecipient[] = (data.items ?? []).map((item: any) => ({
          name: item.name ?? "",
          wallet: item.wallet_pubkey,
          description: item.description ?? "",
          amount: (item.amount / 1_000_000).toLocaleString(),
        }));
        setRecipients(mapped);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [batch.id]);

  const visible = expanded ? recipients : recipients.slice(0, INITIAL_SHOW);
  const hasMore = recipients.length > INITIAL_SHOW;
  const hiddenCount = recipients.length - INITIAL_SHOW;

  return (
    <div className="animate-slide-up">
      <button onClick={onBack} className="text-xs text-bp-muted hover:text-bp-dark mb-4 cursor-pointer">
        ← Back
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
        <div>
          <h1 className="font-display text-xl sm:text-[22px] text-bp-dark tracking-tight">{batch.title}</h1>
          <p className="text-xs text-bp-muted mt-0.5">
            {batch.date} · {batch.recipientCount} recipients · {batch.total} USDC
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded font-medium self-start ${sBadge[batch.status] ?? sBadge.pending}`}>
          <span className="w-1 h-1 rounded-full bg-current" />
          {sLabel[batch.status] ?? batch.status}
        </span>
      </div>

      {batch.txSignatures.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {batch.txSignatures.map((sig, i) => (
            <span key={i} className="font-mono text-[10px] text-bp-hint bg-gray-100 px-2 py-1 rounded">
              tx{batch.txSignatures.length > 1 ? ` ${i + 1}` : ""}: {sig.slice(0, 8)}...{sig.slice(-8)}
            </span>
          ))}
        </div>
      )}

      <div className="bg-white border border-bp-border rounded-lg overflow-hidden">
        <div className="hidden sm:flex items-center px-3 py-2 border-b border-bp-border-light text-[11px] text-bp-hint tracking-wide uppercase">
          <div className="w-[20%]">Name</div>
          <div className="w-[25%]">Wallet</div>
          <div className="w-[35%]">Description</div>
          <div className="w-[20%] text-right">Amount</div>
        </div>

        {loading ? (
          <div className="px-3 py-6 text-center text-[13px] text-bp-muted">Loading recipients...</div>
        ) : recipients.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-bp-muted">No recipient data available</div>
        ) : (
          <>
            {visible.map((r, i) => (
              <div key={i} className="border-b border-gray-50 last:border-b-0">
                <div className="hidden sm:flex items-center px-3 py-2.5">
                  <div className="w-[20%] min-w-0">
                    {r.name
                      ? <span className="text-[13px] font-medium text-bp-dark truncate block">{r.name}</span>
                      : <span className="text-[13px] text-bp-hint italic">— unnamed —</span>}
                  </div>
                  <div className="w-[25%] font-mono text-[11px] text-bp-muted truncate">
                    {r.wallet.slice(0, 8)}...{r.wallet.slice(-8)}
                  </div>
                  <div className="w-[35%] text-[12px] text-bp-muted truncate pr-2">{r.description || "—"}</div>
                  <div className="w-[20%] font-mono text-[11px] text-bp-muted text-right">{r.amount} USDC</div>
                </div>
                <div className="sm:hidden px-3 py-2.5 space-y-0.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[13px] font-medium text-bp-dark truncate">
                      {r.name || <span className="text-bp-hint italic font-normal">— unnamed —</span>}
                    </span>
                    <span className="font-mono text-[12px] text-bp-dark flex-shrink-0 ml-2">{r.amount} USDC</span>
                  </div>
                  <div className="font-mono text-[10px] text-bp-hint">{r.wallet.slice(0, 8)}...{r.wallet.slice(-8)}</div>
                  {r.description && <div className="text-[11px] text-bp-muted">{r.description}</div>}
                </div>
              </div>
            ))}
            {hasMore && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-full py-2 text-center text-[12px] font-medium text-bp-dark-btn border-t border-bp-border-light hover:bg-gray-50 transition-colors cursor-pointer"
              >
                {expanded ? "Show fewer ↑" : `Show ${hiddenCount} more ↓`}
              </button>
            )}
          </>
        )}
      </div>

      {batch.txSignatures[0] && (
        <div className="mt-3">
          <a
            href={`https://explorer.solana.com/tx/${batch.txSignatures[0]}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-bp-dark-btn text-white font-medium text-xs px-4 py-2 rounded-md hover:bg-bp-dark-btn-hover transition-all cursor-pointer"
          >
            View on explorer ↗
          </a>
        </div>
      )}
    </div>
  );
}
