// ─── On-chain / shared ─────────────────────────────────────────────────────

export interface Recipient {
  name: string;
  address: string;
  description: string;
  amount: string;
  ataStatus: "unknown" | "checking" | "ready" | "missing" | "error";
}

export interface BatchRecord {
  id: string;
  title: string;
  date: string;
  recipientCount: number;
  total: string;
  status: "confirmed" | "pending" | "failed" | "submitted";
  txSignatures: string[];
  recipients: BatchRecipient[];
}

export interface BatchRecipient {
  name: string;
  wallet: string;
  description: string;
  amount: string;
}

export interface ScheduleRecord {
  id: string;
  schedule_pda: string;
  mint_address: string;
  recurrence: "once" | "daily" | "weekly" | "monthly";
  scheduled_at: string;
  status: "pending" | "running" | "confirmed" | "failed" | "cancelled";
  runs_completed: number;
  max_runs: number;
  last_error: string | null;
  tx_signature: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface MintRecord {
  wallet: string;
  amount: string;
  when: string;
}

// lib/types.ts
export interface UserProfile {
  name: string;
  wallet: string;
  allTimeSent?: string;
  totalBatches?: number;
  totalRecipients?: number;
  activeSchedules?: number;
}

export interface Contact {
  name: string;
  address: string;
  ataReady: boolean;
}

// ─── Batch execution ────────────────────────────────────────────────────────

export interface SubBatch {
  index: number;
  recipients: Recipient[];
  status: "pending" | "signing" | "submitted" | "confirmed" | "failed";
  txSignature?: string;
  error?: string;
}

export interface BatchProgress {
  totalRecipients: number;
  subBatches: SubBatch[];
  phase: "preparing" | "checking-atas" | "creating-atas" | "signing" | "submitting" | "confirming" | "done" | "error";
  atasToCreate: number;
  atasCreated: number;
}

// ─── Page routing ───────────────────────────────────────────────────────────

export type Page =
  | "dashboard"
  | "send"
  | "history"
  | "schedules"
  | "faucet"
  | "profile"
  | "batch-detail";
