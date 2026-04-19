export interface Recipient {
  name: string;
  address: string;
  description: string;
  amount: string;
}

export interface BatchRecord {
  id: string;
  title: string;
  date: string;
  recipientCount: number;
  total: string;
  status: "confirmed" | "pending" | "scheduled";
  txSignature: string;
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
  name: string;
  recurrence: string;
  nextRun: string;
  runsCompleted: number;
  maxRuns: number;
  status: "active" | "running" | "cancelled";
}

export interface MintRecord {
  wallet: string;
  amount: string;
  when: string;
}

export interface UserProfile {
  name: string;
  wallet: string;
  allTimeSent: string;
  totalBatches: number;
  totalRecipients: number;
  activeSchedules: number;
}

export type Page =
  | "dashboard"
  | "send"
  | "history"
  | "schedules"
  | "faucet"
  | "profile"
  | "batch-detail";
