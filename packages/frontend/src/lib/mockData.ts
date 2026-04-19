import { BatchRecord, ScheduleRecord, MintRecord, UserProfile } from "./types";

export const mockBatches: BatchRecord[] = [
  {
    id: "1",
    title: "March payroll",
    date: "Apr 16 · 14:32",
    recipientCount: 25,
    total: "2,500",
    status: "confirmed",
    txSignature: "5jQr...8xNa",
    recipients: [
      { name: "Alice Johnson", wallet: "7xKX...dE9r", description: "Senior engineer — March salary", amount: "100" },
      { name: "Bob Mensah", wallet: "3rFB...nP2k", description: "Product designer — March salary", amount: "100" },
      { name: "", wallet: "9mPQ...xZ3a", description: "Freelance consultant", amount: "100" },
      { name: "Fatima Al-Rashid", wallet: "2kLM...vR7c", description: "QA lead — March salary", amount: "100" },
      { name: "James Obi", wallet: "8sKJ...bN1p", description: "Backend developer", amount: "100" },
      { name: "Grace Adeyemi", wallet: "5tPR...kL8m", description: "Frontend developer", amount: "100" },
      { name: "", wallet: "1nWQ...hJ4v", description: "DevOps contractor", amount: "100" },
      { name: "David Park", wallet: "6mXC...rA9s", description: "Marketing lead", amount: "100" },
      { name: "Yemi Adesanya", wallet: "4bKN...eT2w", description: "Community manager", amount: "100" },
      { name: "Sarah Chen", wallet: "3pHL...mR5n", description: "Data analyst", amount: "100" },
    ],
  },
  {
    id: "2",
    title: "Contractor run",
    date: "Apr 14 · 09:11",
    recipientCount: 8,
    total: "960",
    status: "confirmed",
    txSignature: "7kPm...2zBc",
    recipients: [
      { name: "Tunde Bakare", wallet: "2xRT...9kPq", description: "UI/UX contract — April", amount: "120" },
      { name: "Lin Wei", wallet: "5mNJ...3rFs", description: "Smart contract audit", amount: "120" },
      { name: "Carlos Mendez", wallet: "8pQW...7vLk", description: "Security review", amount: "120" },
    ],
  },
  {
    id: "3",
    title: "Q1 bonuses",
    date: "Apr 10 · 11:45",
    recipientCount: 6,
    total: "3,000",
    status: "pending",
    txSignature: "",
    recipients: [
      { name: "Alice Johnson", wallet: "7xKX...dE9r", description: "Q1 performance bonus", amount: "500" },
      { name: "James Obi", wallet: "8sKJ...bN1p", description: "Q1 performance bonus", amount: "500" },
    ],
  },
  {
    id: "4",
    title: "Feb payroll",
    date: "Mar 30",
    recipientCount: 25,
    total: "2,500",
    status: "confirmed",
    txSignature: "2mHs...9wKj",
    recipients: [],
  },
];

export const mockSchedules: ScheduleRecord[] = [
  { id: "s1", name: "Weekly stipends", recurrence: "Every 7 days", nextRun: "Apr 19", runsCompleted: 3, maxRuns: 5, status: "active" },
  { id: "s2", name: "Monthly payroll", recurrence: "Every 30 days", nextRun: "May 01", runsCompleted: 1, maxRuns: 4, status: "active" },
  { id: "s3", name: "Advisor retainer", recurrence: "Every 30 days", nextRun: "May 15", runsCompleted: 0, maxRuns: 0, status: "running" },
];

export const mockMints: MintRecord[] = [
  { wallet: "7xKX...dE9r", amount: "10,000 USDC", when: "2h ago" },
  { wallet: "3rFB...nP2k", amount: "10,000 USDC", when: "5h ago" },
  { wallet: "9mPQ...xZ3a", amount: "10,000 USDC", when: "yesterday" },
];

export const mockProfile: UserProfile = {
  name: "Francis",
  wallet: "7xKXabc123456789dE9r",
  allTimeSent: "48,230",
  totalBatches: 12,
  totalRecipients: 89,
  activeSchedules: 3,
};
