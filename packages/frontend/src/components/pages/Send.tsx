"use client";

import { useState, useEffect } from "react";

interface RecipientRow {
  id: number;
  name: string;
  address: string;
  description: string;
  amount: string;
}

interface Props {
  initialScheduleMode: boolean;
  onResetScheduleMode: () => void;
}

let nextId = 4;

export default function Send({ initialScheduleMode, onResetScheduleMode }: Props) {
  const [mode, setMode] = useState<"now" | "schedule">(initialScheduleMode ? "schedule" : "now");
  const [batchTitle, setBatchTitle] = useState("");
  const [recipients, setRecipients] = useState<RecipientRow[]>([
    { id: 1, name: "Alice Johnson", address: "7xKXabc123456dE9r", description: "March salary", amount: "100" },
    { id: 2, name: "Bob Mensah", address: "3rFBxyz789012nP2k", description: "Design contract", amount: "250" },
    { id: 3, name: "", address: "", description: "", amount: "" },
  ]);

  useEffect(() => {
    if (initialScheduleMode) {
      setMode("schedule");
      onResetScheduleMode();
    }
  }, [initialScheduleMode, onResetScheduleMode]);

  const addRecipient = () => {
    setRecipients([...recipients, { id: nextId++, name: "", address: "", description: "", amount: "" }]);
  };

  const removeRecipient = (id: number) => {
    setRecipients(recipients.filter((r) => r.id !== id));
  };

  const update = (id: number, field: keyof RecipientRow, value: string) => {
    setRecipients(recipients.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const truncAddr = (addr: string) => (addr.length > 12 ? addr.slice(0, 4) + "..." + addr.slice(-4) : addr);

  const filledRecipients = recipients.filter((r) => r.amount && parseFloat(r.amount) > 0);
  const subtotal = filledRecipients.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  const now = new Date();
  const minDate = now.toISOString().slice(0, 10);
  const minTime = now.toTimeString().slice(0, 5);

  return (
    <div className="animate-slide-up">
      <h1 className="font-display text-xl sm:text-[22px] text-bp-dark tracking-tight">New batch</h1>
      <p className="text-xs text-bp-muted mb-4 mt-0.5">Send USDC to multiple wallets in one transaction</p>

      {/* Mode toggle */}
      <div className="inline-flex bg-gray-200 rounded-md p-0.5 gap-0.5 mb-4">
        <button
          onClick={() => setMode("now")}
          className={`text-xs px-3 py-1 rounded cursor-pointer transition-all font-body
            ${mode === "now" ? "bg-bp-dark text-bp-accent font-medium" : "text-bp-muted"}`}
        >
          Send now
        </button>
        <button
          onClick={() => setMode("schedule")}
          className={`text-xs px-3 py-1 rounded cursor-pointer transition-all font-body
            ${mode === "schedule" ? "bg-bp-dark text-bp-accent font-medium" : "text-bp-muted"}`}
        >
          Schedule
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_210px] gap-3 items-start">
        {/* LEFT COLUMN */}
        <div className="space-y-3">
          {/* Batch title + recipients card */}
          <div className="bg-white border border-bp-border rounded-lg p-3.5">
            {/* Batch title */}
            <div className="mb-3 pb-3 border-b border-bp-border-light">
              <label className="text-[11px] text-bp-hint tracking-wide uppercase block mb-1.5">
                Batch title
              </label>
              <input
                type="text"
                value={batchTitle}
                onChange={(e) => setBatchTitle(e.target.value)}
                placeholder="e.g. March payroll, Contractor run"
                className="w-full h-[30px] px-2.5 border border-gray-300 rounded text-[13px] font-body
                           bg-white text-bp-dark placeholder:text-bp-hint"
              />
            </div>

            <div className="text-[11px] text-bp-hint tracking-wide uppercase mb-2">Recipients</div>

            {/* Column headers */}
            <div className="hidden sm:flex gap-1.5 mb-1 px-0.5">
              <div className="w-[90px] flex-shrink-0 text-[10px] text-bp-hint">Name</div>
              <div className="w-[120px] flex-shrink-0 text-[10px] text-bp-hint">Wallet</div>
              <div className="flex-1 min-w-0 text-[10px] text-bp-hint">Description</div>
              <div className="w-[56px] flex-shrink-0 text-[10px] text-bp-hint text-right">USDC</div>
              <div className="w-[18px] flex-shrink-0" />
            </div>

            {/* Recipient rows */}
            {recipients.map((r) => (
              <div key={r.id} className="mb-1.5">
                {/* Desktop: single row */}
                <div className="hidden sm:flex gap-1.5 items-center">
                  <input
                    value={r.name}
                    onChange={(e) => update(r.id, "name", e.target.value)}
                    placeholder="Name"
                    className="w-[90px] flex-shrink-0 h-[28px] px-2 border border-gray-300 rounded
                               text-[12px] font-body bg-white text-bp-dark placeholder:text-bp-hint"
                  />
                  <input
                    value={truncAddr(r.address)}
                    onFocus={(e) => { e.target.value = r.address; }}
                    onBlur={(e) => { update(r.id, "address", e.target.value); }}
                    onChange={(e) => update(r.id, "address", e.target.value)}
                    placeholder="Paste address"
                    className="w-[120px] flex-shrink-0 h-[28px] px-2 border border-gray-300 rounded
                               text-[11px] font-mono bg-white text-gray-600 placeholder:text-bp-hint placeholder:font-body"
                  />
                  <input
                    value={r.description}
                    onChange={(e) => update(r.id, "description", e.target.value)}
                    placeholder="Description"
                    className="flex-1 min-w-0 h-[28px] px-2 border border-gray-300 rounded
                               text-[12px] font-body bg-white text-bp-dark placeholder:text-bp-hint"
                  />
                  <input
                    value={r.amount}
                    onChange={(e) => update(r.id, "amount", e.target.value)}
                    placeholder="0"
                    className="w-[56px] flex-shrink-0 h-[28px] px-1.5 border border-gray-300 rounded
                               text-[12px] font-mono bg-white text-bp-dark text-right placeholder:text-bp-hint"
                  />
                  <button
                    onClick={() => removeRecipient(r.id)}
                    className="w-[18px] h-[18px] flex-shrink-0 flex items-center justify-center
                               text-gray-300 hover:text-red-500 hover:bg-red-50 rounded text-sm cursor-pointer"
                  >
                    ×
                  </button>
                </div>

                {/* Mobile: stacked */}
                <div className="sm:hidden bg-gray-50 rounded-lg p-2.5 space-y-1.5">
                  <div className="flex gap-1.5">
                    <input
                      value={r.name}
                      onChange={(e) => update(r.id, "name", e.target.value)}
                      placeholder="Name"
                      className="flex-1 h-[28px] px-2 border border-gray-300 rounded
                                 text-[12px] font-body bg-white text-bp-dark placeholder:text-bp-hint"
                    />
                    <input
                      value={r.amount}
                      onChange={(e) => update(r.id, "amount", e.target.value)}
                      placeholder="0"
                      className="w-[56px] flex-shrink-0 h-[28px] px-1.5 border border-gray-300 rounded
                                 text-[12px] font-mono bg-white text-bp-dark text-right placeholder:text-bp-hint"
                    />
                    <button
                      onClick={() => removeRecipient(r.id)}
                      className="w-[18px] h-[18px] flex-shrink-0 flex items-center justify-center
                                 text-gray-300 hover:text-red-500 text-sm cursor-pointer self-center"
                    >
                      ×
                    </button>
                  </div>
                  <input
                    value={r.address}
                    onChange={(e) => update(r.id, "address", e.target.value)}
                    placeholder="Paste wallet address"
                    className="w-full h-[28px] px-2 border border-gray-300 rounded
                               text-[11px] font-mono bg-white text-gray-600 placeholder:text-bp-hint placeholder:font-body"
                  />
                  <input
                    value={r.description}
                    onChange={(e) => update(r.id, "description", e.target.value)}
                    placeholder="Description (stored off-chain)"
                    className="w-full h-[28px] px-2 border border-gray-300 rounded
                               text-[12px] font-body bg-white text-bp-dark placeholder:text-bp-hint"
                  />
                </div>
              </div>
            ))}

            <button
              onClick={addRecipient}
              className="inline-flex items-center gap-1 bg-bp-dark-btn text-bp-accent
                         text-xs font-medium px-3 py-1.5 rounded cursor-pointer
                         hover:bg-bp-dark-btn-hover transition-all mt-1"
            >
              + Add recipient
            </button>

            {/* Schedule fields */}
            {mode === "schedule" && (
              <div className="mt-3 pt-3 border-t border-bp-border-light space-y-2.5 animate-fade-in">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-bp-muted block mb-1">First run date</label>
                    <input
                      type="date"
                      min={minDate}
                      className="w-full h-[30px] px-2 border border-gray-300 rounded text-[12px] font-body bg-white text-bp-dark"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-bp-muted block mb-1">Execution time</label>
                    <input
                      type="time"
                      min={minTime}
                      className="w-full h-[30px] px-2 border border-gray-300 rounded text-[12px] font-body bg-white text-bp-dark"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-bp-muted block mb-1">Recurrence</label>
                    <select className="w-full h-[30px] px-2 border border-gray-300 rounded text-[12px] font-body bg-white text-bp-dark">
                      <option>Once (future-dated)</option>
                      <option>Daily</option>
                      <option>Weekly — every 7 days</option>
                      <option>Monthly — every 30 days</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-bp-muted block mb-1">Max runs (0 = unlimited)</label>
                    <input
                      type="number"
                      defaultValue={0}
                      min={0}
                      className="w-full h-[30px] px-2 border border-gray-300 rounded text-[12px] font-mono bg-white text-bp-dark"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Token card */}
          <div className="bg-white border border-bp-border rounded-lg p-3.5">
            <div className="text-[11px] text-bp-hint tracking-wide uppercase mb-2">Token</div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                $
              </div>
              <div>
                <div className="text-[13px] font-medium text-bp-dark">USDC</div>
                <div className="text-[11px] text-bp-hint">Solana · Devnet</div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN — Summary */}
        <div className="bg-white border border-bp-border rounded-lg p-3.5">
          <div className="text-[11px] text-bp-hint tracking-wide uppercase mb-2.5">Summary</div>
          <div className="space-y-0">
            {[
              ["Recipients", String(filledRecipients.length)],
              ["Subtotal", `${subtotal.toLocaleString()} USDC`],
              ["Fee", "~$0.001"],
              ["New ATAs", "0"],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between text-[12px] py-1 border-b border-gray-50">
                <span className="text-bp-muted">{label}</span>
                <span className="font-mono text-[11px] text-bp-dark">{val}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[13px] font-medium pt-2 mt-1.5 border-t border-bp-border">
            <span className="text-bp-dark">Total</span>
            <span className="font-mono text-bp-dark">{subtotal.toLocaleString()} USDC</span>
          </div>

          <div className="mt-3 pt-3 border-t border-bp-border-light">
            <div className="text-[10px] text-bp-hint mb-1">Wallet balance</div>
            <div className="font-mono text-base font-medium text-bp-dark">5,000 USDC</div>
          </div>

          <button
            className={`block w-full mt-3 py-2.5 text-center rounded-md text-[13px]
                        font-medium cursor-pointer transition-all active:scale-[0.98]
                        ${mode === "now"
                          ? "bg-[#111827] text-bp-accent hover:bg-bp-dark-btn-hover"
                          : "bg-emerald-900 text-bp-accent hover:bg-emerald-800"
                        }`}
          >
            {mode === "now" ? "Review & sign →" : "Create schedule →"}
          </button>
        </div>
      </div>
    </div>
  );
}
