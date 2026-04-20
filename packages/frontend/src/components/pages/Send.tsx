"use client";
import { useState, useEffect, useRef } from "react";
import { useWallet } from "@/context/WalletContext";
import { useToast } from "@/context/ToastContext";
import { Recipient, BatchProgress } from "@/lib/types";
import { mockContacts } from "@/lib/mockData";
import { checkAtaExists, isValidSolanaAddress, truncateAddress } from "@/lib/solana";
import { executeBatch, preflightCheck, MAX_RECIPIENTS_PER_TX } from "@/lib/batch";

interface Props {
  initialScheduleMode: boolean;
  onResetScheduleMode: () => void;
}

let nextId = 4;

const emptyRecipient = (): Recipient => ({
  id: String(nextId++), name: "", address: "", description: "", amount: "", ataStatus: "unknown",
} as any);

export default function Send({ initialScheduleMode, onResetScheduleMode }: Props) {
  const { balance } = useWallet();
  const { addToast } = useToast();

  const [mode, setMode] = useState<"now" | "schedule">(initialScheduleMode ? "schedule" : "now");
  const [batchTitle, setBatchTitle] = useState("");
  const [recipients, setRecipients] = useState<(Recipient & { id: string })[]>([
    { id: "1", name: "Alice Johnson", address: "7xKXabc123456789dE9r", description: "March salary", amount: "100", ataStatus: "ready" },
    { id: "2", name: "Bob Mensah", address: "3rFBxyz789012345nP2k", description: "Design contract", amount: "250", ataStatus: "ready" },
    { id: "3", name: "", address: "", description: "", amount: "", ataStatus: "unknown" },
  ]);
  const [showContacts, setShowContacts] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [preflightErrors, setPreflightErrors] = useState<string[]>([]);
  const [preflightWarnings, setPreflightWarnings] = useState<string[]>([]);

  const ataCheckTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    if (initialScheduleMode) { setMode("schedule"); onResetScheduleMode(); }
  }, [initialScheduleMode, onResetScheduleMode]);

  // ─── ATA check on address change (debounced) ─────────────────────────────

  const triggerAtaCheck = (id: string, address: string) => {
    const existing = ataCheckTimers.current.get(id);
    if (existing) clearTimeout(existing);

    if (!isValidSolanaAddress(address)) {
      updateRecipient(id, "ataStatus", "unknown");
      return;
    }

    updateRecipient(id, "ataStatus", "checking");
    const timer = setTimeout(async () => {
      try {
        const exists = await checkAtaExists(address);
        setRecipients((prev) => prev.map((r) => r.id === id ? { ...r, ataStatus: exists ? "ready" : "missing" } : r));
      } catch {
        setRecipients((prev) => prev.map((r) => r.id === id ? { ...r, ataStatus: "error" } : r));
      }
    }, 600);
    ataCheckTimers.current.set(id, timer);
  };

  // ─── Contact matching ─────────────────────────────────────────────────────

  const matchingContacts = (query: string) => {
    if (query.length < 2) return [];
    const q = query.toLowerCase();
    return mockContacts.filter((c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q));
  };

  // ─── State helpers ────────────────────────────────────────────────────────

  const updateRecipient = (id: string, field: string, value: string) => {
    setRecipients((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleAddressChange = (id: string, value: string) => {
    updateRecipient(id, "address", value);
    triggerAtaCheck(id, value);
  };

  const handleNameChange = (id: string, value: string) => {
    updateRecipient(id, "name", value);
    setShowContacts(value.length >= 2 ? id : null);
  };

  const pickContact = (id: string, contact: typeof mockContacts[0]) => {
    setRecipients((prev) => prev.map((r) => r.id === id
      ? { ...r, name: contact.name, address: contact.address, ataStatus: contact.ataReady ? "ready" : "missing" }
      : r
    ));
    setShowContacts(null);
  };

  const addRecipient = () => setRecipients([...recipients, { ...emptyRecipient() }]);
  const removeRecipient = (id: string) => setRecipients(recipients.filter((r) => r.id !== id));

  // ─── Computed values ──────────────────────────────────────────────────────

  const filled = recipients.filter((r) => r.address && parseFloat(r.amount) > 0);
  const subtotal = filled.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const subBatchCount = Math.ceil(filled.length / MAX_RECIPIENTS_PER_TX);
  const missingAtas = filled.filter((r) => r.ataStatus === "missing").length;

  // ─── Submit handler ───────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setPreflightErrors([]);
    setPreflightWarnings([]);

    const preflight = await preflightCheck(recipients, balance, "USDC_MOCK_MINT");
    setPreflightErrors(preflight.errors);
    setPreflightWarnings(preflight.warnings);

    if (!preflight.valid) return;

    // Start execution — show progress overlay
    const progress = await executeBatch(recipients, "USDC_MOCK_MINT", (p) => setBatchProgress({ ...p }));

    if (progress.phase === "done") {
      addToast(`Batch "${batchTitle || "Untitled"}" confirmed — ${filled.length} recipients`, "success");
      setBatchProgress(null);
      // Reset form
      setBatchTitle("");
      setRecipients([{ ...emptyRecipient() }]);
    }
  };

  // ─── ATA status indicator ──────────────────────────────────────────────────

  const AtaIndicator = ({ status }: { status: Recipient["ataStatus"] }) => {
    if (status === "unknown") return null;
    if (status === "checking") return <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse-slow flex-shrink-0" title="Checking ATA..." />;
    if (status === "ready") return <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" title="ATA ready" />;
    if (status === "missing") return <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" title="ATA needs creating" />;
    return <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" title="ATA check failed" />;
  };

  // ─── Batch progress overlay ───────────────────────────────────────────────

  if (batchProgress) {
    const { phase, subBatches, atasToCreate, atasCreated, totalRecipients } = batchProgress;
    const confirmed = subBatches.filter((b) => b.status === "confirmed").length;
    const pct = phase === "done" ? 100 : phase === "creating-atas"
      ? Math.round((atasCreated / Math.max(atasToCreate, 1)) * 30)
      : phase === "confirming"
        ? 30 + Math.round((confirmed / subBatches.length) * 70)
        : phase === "signing" ? 25 : phase === "submitting" ? 40 : 10;

    return (
      <div className="animate-slide-up">
        <h1 className="font-display text-xl text-bp-dark tracking-tight">Sending batch</h1>
        <p className="text-xs text-bp-muted mb-5 mt-0.5">{totalRecipients} recipients · {subBatches.length} transaction{subBatches.length > 1 ? "s" : ""}</p>

        {/* Progress bar */}
        <div className="bg-gray-200 rounded-full h-2 mb-5 overflow-hidden">
          <div className="h-full bg-bp-accent rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>

        {/* Phase indicator */}
        <div className="bg-white border border-bp-border rounded-lg p-4 mb-4">
          <div className="text-sm font-medium text-bp-dark mb-3 capitalize">{phase.replace(/-/g, " ")}</div>
          {phase === "creating-atas" && (
            <div className="text-xs text-bp-muted">Creating token accounts: {atasCreated} / {atasToCreate}</div>
          )}
          {(phase === "submitting" || phase === "confirming" || phase === "done") && (
            <div className="space-y-2">
              {subBatches.map((b) => (
                <div key={b.index} className="flex items-center gap-3 text-xs">
                  <span className="text-bp-muted w-24">Batch {b.index + 1} ({b.recipients.length})</span>
                  <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-700 ${
                      b.status === "confirmed" ? "bg-emerald-500 w-full"
                        : b.status === "submitted" ? "bg-bp-accent w-2/3"
                          : b.status === "failed" ? "bg-red-500 w-full"
                            : "bg-gray-300 w-0"
                    }`} />
                  </div>
                  <span className={`w-16 text-right font-mono ${
                    b.status === "confirmed" ? "text-emerald-600" : b.status === "failed" ? "text-red-600" : "text-bp-muted"
                  }`}>{b.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {phase === "done" && (
          <button onClick={() => setBatchProgress(null)}
            className="bg-bp-accent text-bp-dark font-medium text-sm px-6 py-2.5 rounded-md hover:bg-bp-accent-hover transition-all cursor-pointer">
            Done
          </button>
        )}
      </div>
    );
  }

  // ─── Main form ────────────────────────────────────────────────────────────

  const minDate = new Date().toISOString().slice(0, 10);

  return (
    <div className="animate-slide-up">
      <h1 className="font-display text-xl sm:text-[22px] text-bp-dark tracking-tight">New batch</h1>
      <p className="text-xs text-bp-muted mb-4 mt-0.5">Send USDC to multiple wallets in one transaction</p>

      {/* Mode toggle */}
      <div className="inline-flex bg-gray-200 rounded-md p-0.5 gap-0.5 mb-4">
        {(["now", "schedule"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`text-xs px-3 py-1 rounded cursor-pointer transition-all font-body ${mode === m ? "bg-bp-dark text-bp-accent font-medium" : "text-bp-muted"}`}>
            {m === "now" ? "Send now" : "Schedule"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_210px] gap-3 items-start">
        {/* LEFT */}
        <div className="space-y-3">
          <div className="bg-white border border-bp-border rounded-lg p-3.5">
            {/* Batch title */}
            <div className="mb-3 pb-3 border-b border-bp-border-light">
              <label className="text-[11px] text-bp-hint tracking-wide uppercase block mb-1.5">Batch title</label>
              <input type="text" value={batchTitle} onChange={(e) => setBatchTitle(e.target.value)}
                placeholder="e.g. March payroll, Contractor run"
                className="w-full h-[30px] px-2.5 border border-gray-300 rounded text-[13px] font-body bg-white text-bp-dark placeholder:text-bp-hint" />
            </div>

            <div className="text-[11px] text-bp-hint tracking-wide uppercase mb-2">
              Recipients
              {filled.length > 0 && <span className="ml-2 text-bp-muted font-mono">({filled.length})</span>}
              {missingAtas > 0 && (
                <span className="ml-2 text-amber-600 font-mono">· {missingAtas} need ATA</span>
              )}
            </div>

            {/* Column headers — desktop */}
            <div className="hidden sm:flex gap-1.5 mb-1 px-0.5 text-[10px] text-bp-hint">
              <div className="w-[90px] flex-shrink-0">Name</div>
              <div className="w-[110px] flex-shrink-0">Wallet</div>
              <div className="flex-1 min-w-0">Description</div>
              <div className="w-[56px] flex-shrink-0 text-right">USDC</div>
              <div className="w-[22px] flex-shrink-0" />
            </div>

            {/* Recipient rows */}
            {recipients.map((r) => (
              <div key={r.id} className="mb-1.5">
                {/* Desktop row */}
                <div className="hidden sm:flex gap-1.5 items-center">
                  <div className="w-[90px] flex-shrink-0 relative">
                    <input value={r.name} onChange={(e) => handleNameChange(r.id, e.target.value)}
                      onBlur={() => setTimeout(() => setShowContacts(null), 200)}
                      placeholder="Name"
                      className="w-full h-[28px] px-2 border border-gray-300 rounded text-[12px] font-body bg-white text-bp-dark placeholder:text-bp-hint" />
                    {showContacts === r.id && matchingContacts(r.name).length > 0 && (
                      <div className="absolute top-[30px] left-0 w-[220px] bg-white border border-gray-200 rounded-md z-20 overflow-hidden animate-fade-in">
                        {matchingContacts(r.name).map((c) => (
                          <button key={c.address} onMouseDown={() => pickContact(r.id, c)}
                            className="w-full text-left px-2.5 py-2 hover:bg-gray-50 flex justify-between items-center cursor-pointer">
                            <span className="text-[12px] font-medium text-bp-dark">{c.name}</span>
                            <span className="font-mono text-[10px] text-bp-hint">{truncateAddress(c.address)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="w-[110px] flex-shrink-0 flex items-center gap-1">
                    <AtaIndicator status={r.ataStatus} />
                    <input value={r.address} onChange={(e) => handleAddressChange(r.id, e.target.value)}
                      placeholder="Paste address"
                      className="w-full h-[28px] px-2 border border-gray-300 rounded text-[11px] font-mono bg-white text-gray-600 placeholder:text-bp-hint placeholder:font-body" />
                  </div>
                  <input value={r.description} onChange={(e) => updateRecipient(r.id, "description", e.target.value)}
                    placeholder="Description"
                    className="flex-1 min-w-0 h-[28px] px-2 border border-gray-300 rounded text-[12px] font-body bg-white text-bp-dark placeholder:text-bp-hint" />
                  <input value={r.amount} onChange={(e) => updateRecipient(r.id, "amount", e.target.value)}
                    placeholder="0"
                    className="w-[56px] flex-shrink-0 h-[28px] px-1.5 border border-gray-300 rounded text-[12px] font-mono bg-white text-bp-dark text-right placeholder:text-bp-hint" />
                  <button onClick={() => removeRecipient(r.id)}
                    className="w-[22px] h-[22px] flex-shrink-0 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded text-sm cursor-pointer">x</button>
                </div>

                {/* Mobile row */}
                <div className="sm:hidden bg-gray-50 rounded-lg p-2.5 space-y-1.5">
                  <div className="flex gap-1.5">
                    <input value={r.name} onChange={(e) => handleNameChange(r.id, e.target.value)} placeholder="Name"
                      className="flex-1 h-[28px] px-2 border border-gray-300 rounded text-[12px] font-body bg-white text-bp-dark placeholder:text-bp-hint" />
                    <input value={r.amount} onChange={(e) => updateRecipient(r.id, "amount", e.target.value)} placeholder="0"
                      className="w-[56px] flex-shrink-0 h-[28px] px-1.5 border border-gray-300 rounded text-[12px] font-mono bg-white text-bp-dark text-right" />
                    <button onClick={() => removeRecipient(r.id)}
                      className="w-[18px] h-[18px] flex items-center justify-center text-gray-300 hover:text-red-500 text-sm cursor-pointer self-center">x</button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <AtaIndicator status={r.ataStatus} />
                    <input value={r.address} onChange={(e) => handleAddressChange(r.id, e.target.value)} placeholder="Paste wallet address"
                      className="flex-1 h-[28px] px-2 border border-gray-300 rounded text-[11px] font-mono bg-white text-gray-600 placeholder:text-bp-hint placeholder:font-body" />
                  </div>
                  <input value={r.description} onChange={(e) => updateRecipient(r.id, "description", e.target.value)} placeholder="Description"
                    className="w-full h-[28px] px-2 border border-gray-300 rounded text-[12px] font-body bg-white text-bp-dark placeholder:text-bp-hint" />
                </div>
              </div>
            ))}

            <button onClick={addRecipient}
              className="inline-flex items-center gap-1 bg-bp-dark-btn text-bp-accent text-xs font-medium px-3 py-1.5 rounded cursor-pointer hover:bg-bp-dark-btn-hover transition-all mt-1">
              + Add recipient
            </button>

            {/* Schedule fields */}
            {mode === "schedule" && (
              <div className="mt-3 pt-3 border-t border-bp-border-light space-y-2.5 animate-fade-in">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-bp-muted block mb-1">First run date</label>
                    <input type="date" min={minDate} className="w-full h-[30px] px-2 border border-gray-300 rounded text-[12px] font-body bg-white text-bp-dark" />
                  </div>
                  <div>
                    <label className="text-[11px] text-bp-muted block mb-1">Execution time</label>
                    <input type="time" className="w-full h-[30px] px-2 border border-gray-300 rounded text-[12px] font-body bg-white text-bp-dark" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-bp-muted block mb-1">Recurrence</label>
                    <select className="w-full h-[30px] px-2 border border-gray-300 rounded text-[12px] font-body bg-white text-bp-dark">
                      <option>Once (future-dated)</option><option>Daily</option><option>Weekly</option><option>Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-bp-muted block mb-1">Max runs (0 = unlimited)</label>
                    <input type="number" defaultValue={0} min={0} className="w-full h-[30px] px-2 border border-gray-300 rounded text-[12px] font-mono bg-white text-bp-dark" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-bp-border rounded-lg p-3.5">
            <div className="text-[11px] text-bp-hint tracking-wide uppercase mb-2">Token</div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">$</div>
              <div>
                <div className="text-[13px] font-medium text-bp-dark">USDC</div>
                <div className="text-[11px] text-bp-hint">Solana · Devnet</div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — Summary */}
        <div className="bg-white border border-bp-border rounded-lg p-3.5">
          <div className="text-[11px] text-bp-hint tracking-wide uppercase mb-2.5">Summary</div>
          {[
            ["Recipients", String(filled.length)],
            ["Subtotal", `${subtotal.toLocaleString()} USDC`],
            ["Fee", "~$0.001"],
            ["Missing ATAs", String(missingAtas)],
          ].map(([l, v]) => (
            <div key={l} className="flex justify-between text-[12px] py-1 border-b border-gray-50">
              <span className="text-bp-muted">{l}</span>
              <span className={`font-mono text-[11px] ${l === "Missing ATAs" && missingAtas > 0 ? "text-amber-600" : "text-bp-dark"}`}>{v}</span>
            </div>
          ))}
          <div className="flex justify-between text-[13px] font-medium pt-2 mt-1.5 border-t border-bp-border">
            <span className="text-bp-dark">Total</span>
            <span className="font-mono text-bp-dark">{subtotal.toLocaleString()} USDC</span>
          </div>
          {subBatchCount > 1 && (
            <div className="text-[11px] text-blue-600 mt-2 bg-blue-50 px-2 py-1.5 rounded">
              Will be split into {subBatchCount} transactions
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-bp-border-light">
            <div className="text-[10px] text-bp-hint mb-1">Wallet balance</div>
            <div className="font-mono text-base font-medium text-bp-dark">{balance.toLocaleString()} USDC</div>
          </div>

          {/* Preflight errors/warnings */}
          {preflightErrors.length > 0 && (
            <div className="mt-3 space-y-1">{preflightErrors.map((e, i) => (
              <div key={i} className="text-[11px] text-red-600 bg-red-50 px-2 py-1.5 rounded">{e}</div>
            ))}</div>
          )}
          {preflightWarnings.length > 0 && (
            <div className="mt-2 space-y-1">{preflightWarnings.map((w, i) => (
              <div key={i} className="text-[11px] text-amber-700 bg-amber-50 px-2 py-1.5 rounded">{w}</div>
            ))}</div>
          )}

          <button onClick={handleSubmit}
            className={`block w-full mt-3 py-2.5 text-center rounded-md text-[13px] font-medium cursor-pointer transition-all active:scale-[0.98]
              ${mode === "now" ? "bg-[#111827] text-bp-accent hover:bg-bp-dark-btn-hover" : "bg-emerald-900 text-bp-accent hover:bg-emerald-800"}`}>
            {mode === "now" ? "Review & sign \u2192" : "Create schedule \u2192"}
          </button>
        </div>
      </div>
    </div>
  );
}
