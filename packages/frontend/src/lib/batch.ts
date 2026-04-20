// lib/batch.ts
//
// Batch splitting, parallel execution, and progress tracking.
// Handles the full flow: validate → check ATAs → create missing → split → sign → submit → confirm

import { Recipient, SubBatch, BatchProgress } from "./types";
import { checkMultipleAtas, createMissingAtas, sleep } from "./solana";

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_RECIPIENTS_PER_TX = 30;  // conservative — leaves CU headroom
export const MAX_COMPUTE_UNITS = 1_400_000;

// ─── Split recipients into sub-batches ────────────────────────────────────────

export function splitIntoBatches(recipients: Recipient[]): SubBatch[] {
  const batches: SubBatch[] = [];
  for (let i = 0; i < recipients.length; i += MAX_RECIPIENTS_PER_TX) {
    batches.push({
      index: batches.length,
      recipients: recipients.slice(i, i + MAX_RECIPIENTS_PER_TX),
      status: "pending",
    });
  }
  return batches;
}

// ─── Compute budget for a batch ───────────────────────────────────────────────

export function computeBudget(recipientCount: number): number {
  return Math.min(50_000 + recipientCount * 35_000, MAX_COMPUTE_UNITS);
}

// ─── Full batch execution flow ────────────────────────────────────────────────
//
// This is the main entry point for sending a batch in production.
// It orchestrates the entire flow and reports progress via callback.

export async function executeBatch(
  recipients: Recipient[],
  mint: string,
  onProgress: (progress: BatchProgress) => void
): Promise<BatchProgress> {
  const filled = recipients.filter((r) => r.address && parseFloat(r.amount) > 0);
  const subBatches = splitIntoBatches(filled);

  const progress: BatchProgress = {
    totalRecipients: filled.length,
    subBatches,
    phase: "preparing",
    atasToCreate: 0,
    atasCreated: 0,
  };

  const update = () => onProgress({ ...progress, subBatches: [...progress.subBatches] });

  // ── Phase 1: Check ATAs ──────────────────────────────────────────────────
  progress.phase = "checking-atas";
  update();

  const addresses = filled.map((r) => r.address);
  const ataMap = await checkMultipleAtas(addresses, mint);

  const missingAtas = addresses.filter((a) => !ataMap.get(a));
  progress.atasToCreate = missingAtas.length;
  update();

  // ── Phase 2: Create missing ATAs ─────────────────────────────────────────
  if (missingAtas.length > 0) {
    progress.phase = "creating-atas";
    update();

    await createMissingAtas(missingAtas, mint, (created, total) => {
      progress.atasCreated = created;
      update();
    });
  }

  // ── Phase 3: Sign all transactions ───────────────────────────────────────
  // Real: build all instructions, call wallet.signAllTransactions(txs)
  progress.phase = "signing";
  progress.subBatches.forEach((b) => (b.status = "signing"));
  update();

  await sleep(800); // simulate wallet popup

  // ── Phase 4: Submit all simultaneously ───────────────────────────────────
  progress.phase = "submitting";
  progress.subBatches.forEach((b) => (b.status = "submitted"));
  update();

  // Real: Promise.all(signedTxs.map(tx => connection.sendRawTransaction(...)))
  await Promise.all(
    progress.subBatches.map(async (batch, i) => {
      await sleep(300 + Math.random() * 400); // simulate network
      batch.txSignature = `mock_sig_${Date.now().toString(36)}_${i}`;
      batch.status = "submitted";
      update();
    })
  );

  // ── Phase 5: Confirm all in parallel ─────────────────────────────────────
  progress.phase = "confirming";
  update();

  // Real: Promise.all(sigs.map(sig => connection.confirmTransaction(sig)))
  await Promise.all(
    progress.subBatches.map(async (batch) => {
      await sleep(1500 + Math.random() * 1000); // simulate confirmation
      batch.status = "confirmed";
      update();
    })
  );

  progress.phase = "done";
  update();

  return progress;
}

// ─── Pre-flight validation ────────────────────────────────────────────────────

export interface PreflightResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalAmount: number;
  recipientCount: number;
  subBatchCount: number;
  missingAtaCount: number;
}

export async function preflightCheck(
  recipients: Recipient[],
  senderBalance: number,
  mint: string
): Promise<PreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const filled = recipients.filter((r) => r.address && parseFloat(r.amount) > 0);
  const totalAmount = filled.reduce((s, r) => s + parseFloat(r.amount), 0);
  const subBatchCount = Math.ceil(filled.length / MAX_RECIPIENTS_PER_TX);

  if (filled.length === 0) {
    errors.push("No valid recipients — add at least one address and amount.");
  }

  if (totalAmount > senderBalance) {
    errors.push(`Insufficient balance: need ${totalAmount.toLocaleString()} USDC but wallet has ${senderBalance.toLocaleString()} USDC.`);
  }

  // Check for duplicate addresses
  const addrSet = new Set<string>();
  for (const r of filled) {
    if (addrSet.has(r.address)) {
      warnings.push(`Duplicate address: ${r.address.slice(0, 8)}... appears more than once.`);
    }
    addrSet.add(r.address);
  }

  // Check ATAs
  const ataMap = await checkMultipleAtas(filled.map((r) => r.address), mint);
  const missingAtaCount = [...ataMap.values()].filter((v) => !v).length;

  if (missingAtaCount > 0) {
    warnings.push(`${missingAtaCount} recipient(s) don't have token accounts yet. They will be created automatically (~0.002 SOL each).`);
  }

  if (subBatchCount > 1) {
    warnings.push(`This batch will be split into ${subBatchCount} transactions of up to ${MAX_RECIPIENTS_PER_TX} recipients each.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    totalAmount,
    recipientCount: filled.length,
    subBatchCount,
    missingAtaCount,
  };
}
