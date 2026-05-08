import { Connection, PublicKey } from "@solana/web3.js";
import { authHeaders, getJwt } from "./auth";
import { UserProfile, ScheduleRecord } from "./types";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { connection, USDC_MINT } from "./solana";
import { Program } from "@coral-xyz/anchor";
import { BulkPay } from "../../../../shared/types/bulk_pay";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function fetchNonce(wallet: string): Promise<{ nonce: string; message: string }> {
    const res = await fetch(`${BASE_URL}/auth/nonce?wallet=${wallet}`);
    if (!res.ok) throw new Error("Failed to fetch nonce");
    return res.json();
}

export async function verifySignature(
    wallet: string,
    nonce: string,
    signature: string,
): Promise<{ token: string }> {
    const res = await fetch(`${BASE_URL}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, nonce, signature }),
    });
    if (!res.ok) throw new Error("Signature verification failed");
    return res.json();
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function fetchUserProfile(wallet: string): Promise<UserProfile> {
    const res = await fetch(`${BASE_URL}/users/${wallet}`, {
        headers: authHeaders(),
    });

    if (res.status === 404) {
        // New user — backend has no record yet, return empty profile
        return {
            wallet,
            name: "Stranger",
            allTimeSent: "0",
            totalBatches: 0,
            totalRecipients: 0,
            activeSchedules: 0,
        };
    }

    if (!res.ok) throw new Error("Failed to fetch user profile");

    const data = await res.json();

    return {
        wallet: data.wallet,
        name: data.display_name ?? "Stranger",
        allTimeSent: (data.all_time_sent / 1_000_000).toLocaleString(), // lamports → USDC
        totalBatches: data.total_batches,
        totalRecipients: data.total_recipients,
        activeSchedules: data.active_schedules,
    };
}

// ── Contacts ──────────────────────────────────────────────────────────────────

export async function fetchContacts() {
    const res = await fetch(`${BASE_URL}/contacts`, {
        headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch contacts");
    return res.json();
}

export async function searchContacts(query: string) {
    const res = await fetch(`${BASE_URL}/contacts?q=${encodeURIComponent(query)}`, {
        headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to search contacts");
    return res.json();
}

// ── Batches ───────────────────────────────────────────────────────────────────

export async function fetchBatches() {
    const res = await fetch(`${BASE_URL}/batches`, {
        headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch batches");
    return res.json();
}

export async function fetchBatchDetail(id: string) {
    const res = await fetch(`${BASE_URL}/batches/${id}`, {
        headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch batch detail");
    return res.json();
}
// ── Schedules ─────────────────────────────────────────────────────────────────

export async function fetchSchedules() {
    const res = await fetch(`${BASE_URL}/schedules`, {
        headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch schedules");
    return res.json();
}


export async function fetchDelegationStatus(): Promise<{
    active: boolean;
    expires_at: string | null;
    max_amount: number | null;
}> {
    const res = await fetch(`${BASE_URL}/delegate`, {
        headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch delegation status");
    return res.json();
}

export async function registerDelegate(body: {
    delegate_pda: string;
    mint_address: string;
    max_amount: number;
    expires_at: number;   // unix timestamp
    created_at_seed: number;
}): Promise<void> {
    const res = await fetch(`${BASE_URL}/delegate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to register delegation");
}

export async function createSchedule(body: {
    schedule_pda: string;
    created_at_seed: number;
    mint_address: string;
    delegate_pda: string;
    recipients: { wallet: string; amount: number; name?: string; description?: string }[];
    recurrence: string;
    scheduled_at: string;
    max_runs: number;
    notes?: string;
}): Promise<ScheduleRecord> {
    const res = await fetch(`${BASE_URL}/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to create schedule");
    return res.json();
}

// Fetch all schedules for this user
export async function fetchAllSchedules(): Promise<ScheduleRecord[]> {
    const res = await fetch(`${BASE_URL}/schedules`, {
        headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch schedules");
    return res.json();
}

// Update existing delegation in DB
export async function updateDelegate(body: {
    max_amount: number;
    expires_at: string;
}): Promise<void> {
    const res = await fetch(`${BASE_URL}/delegate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to update delegation");
}