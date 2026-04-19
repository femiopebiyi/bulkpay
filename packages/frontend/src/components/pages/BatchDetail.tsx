"use client";

import { useState } from "react";
import { BatchRecord } from "@/lib/types";

interface Props {
  batch: BatchRecord;
  onBack: () => void;
}

const statusStyle: Record<string, string> = {
  confirmed: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  scheduled: "bg-blue-100 text-blue-800",
};

const statusLabel: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  scheduled: "Scheduled",
};

const INITIAL_SHOW = 5;

export default function BatchDetail({ batch, onBack }: Props) {
  const [expanded, setExpanded] = useState(false);

  const visibleRecipients = expanded ? batch.recipients : batch.recipients.slice(0, INITIAL_SHOW);
  const hasMore = batch.recipients.length > INITIAL_SHOW;
  const hiddenCount = batch.recipients.length - INITIAL_SHOW;
  const hiddenTotal = batch.recipients
    .slice(INITIAL_SHOW)
    .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  return (
    <div className="animate-slide-up">
      <button
        onClick={onBack}
        className="text-xs text-bp-muted hover:text-bp-dark mb-4 cursor-pointer"
      >
        ← Back
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
        <div>
          <h1 className="font-display text-xl sm:text-[22px] text-bp-dark tracking-tight">
            {batch.title}
          </h1>
          <p className="text-xs text-bp-muted mt-0.5">
            {batch.date} · {batch.recipientCount} recipients · {batch.total} USDC
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded font-medium
                      self-start ${statusStyle[batch.status]}`}
        >
          <span className="w-1 h-1 rounded-full bg-current" />
          {statusLabel[batch.status]}
        </span>
      </div>

      {/* Recipients table */}
      <div className="bg-white border border-bp-border rounded-lg overflow-hidden">
        {/* Header — hidden on mobile */}
        <div className="hidden sm:flex items-center px-3 py-2 border-b border-bp-border-light
                        text-[11px] text-bp-hint tracking-wide uppercase">
          <div className="w-[22%]">Name</div>
          <div className="w-[22%]">Wallet</div>
          <div className="w-[36%]">Description</div>
          <div className="w-[20%] text-right">Amount</div>
        </div>

        {/* Recipient rows */}
        {visibleRecipients.map((r, i) => (
          <div
            key={i}
            className="border-b border-gray-50 last:border-b-0"
          >
            {/* Desktop row */}
            <div className="hidden sm:flex items-center px-3 py-2.5">
              <div className="w-[22%] min-w-0">
                {r.name ? (
                  <span className="text-[13px] font-medium text-bp-dark truncate block">{r.name}</span>
                ) : (
                  <span className="text-[13px] text-bp-hint italic">— unnamed —</span>
                )}
              </div>
              <div className="w-[22%] font-mono text-[11px] text-bp-muted">{r.wallet}</div>
              <div className="w-[36%] text-[12px] text-bp-muted truncate pr-2">{r.description || "—"}</div>
              <div className="w-[20%] font-mono text-[11px] text-bp-muted text-right">{r.amount} USDC</div>
            </div>

            {/* Mobile row — stacked */}
            <div className="sm:hidden px-3 py-2.5 space-y-0.5">
              <div className="flex justify-between items-center">
                <span className="text-[13px] font-medium text-bp-dark truncate">
                  {r.name || <span className="text-bp-hint italic font-normal">— unnamed —</span>}
                </span>
                <span className="font-mono text-[12px] text-bp-dark flex-shrink-0 ml-2">
                  {r.amount} USDC
                </span>
              </div>
              <div className="font-mono text-[10px] text-bp-hint">{r.wallet}</div>
              {r.description && (
                <div className="text-[11px] text-bp-muted">{r.description}</div>
              )}
            </div>
          </div>
        ))}

        {/* Collapsed summary row — shows when not expanded and there are hidden rows */}
        {hasMore && !expanded && (
          <div className="hidden sm:flex items-center px-3 py-2 bg-gray-50/70 text-[12px] text-bp-hint">
            <div className="w-[22%]">+{hiddenCount} more…</div>
            <div className="w-[22%]" />
            <div className="w-[36%]" />
            <div className="w-[20%] font-mono text-[11px] text-right">
              {hiddenTotal.toLocaleString()} USDC
            </div>
          </div>
        )}

        {/* Expand/collapse toggle */}
        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full py-2 text-center text-[12px] font-medium text-bp-dark-btn
                       border-t border-bp-border-light hover:bg-gray-50
                       transition-colors cursor-pointer"
          >
            {expanded
              ? "Show fewer recipients ↑"
              : `Show ${hiddenCount} more recipients ↓`}
          </button>
        )}
      </div>

      {/* Footer actions */}
      <div className="mt-3 flex gap-2">
        {batch.txSignature && (
          <a
            href={`https://explorer.solana.com/tx/${batch.txSignature}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-bp-dark-btn text-white font-medium text-xs
                       px-4 py-2 rounded-md hover:bg-bp-dark-btn-hover transition-all cursor-pointer"
          >
            View on explorer ↗
          </a>
        )}
      </div>
    </div>
  );
}
