import { authHeaders, getJwt } from "./auth";
import { UserProfile } from "./types";

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
