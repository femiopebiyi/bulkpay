// lib/solana.ts
//
// Production-ready Solana utilities for BulkPay.
// Test mint is used for devnet — swap USDC_MINT for mainnet deployment.

import {
    Connection,
    PublicKey,
    TransactionInstruction,
    clusterApiUrl,
} from "@solana/web3.js";
import {
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
    getAccount,
} from "@solana/spl-token";
import { Program } from "@coral-xyz/anchor";
import { BulkPay } from "../../../../shared/types/bulk_pay";

// ─── Network config ───────────────────────────────────────────────────────────
//
// Swap these two lines when going to mainnet:
//   NETWORK = "mainnet-beta"
//   USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")

export const NETWORK = "devnet";

export const connection = new Connection(
    process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl("devnet"),
    "confirmed",
);

// Devnet test mint — replace with real USDC mint for mainnet
export const USDC_MINT = new PublicKey(
    process.env.NEXT_PUBLIC_USDC_MINT ?? "EaUe6ri7FwqgxVyDcxGAFvfnNczdZVpmosTWo7RCXYZE"
);

// ─── Token balance ────────────────────────────────────────────────────────────

export async function fetchTokenBalance(walletAddress: string): Promise<number> {
    try {
        const owner = new PublicKey(walletAddress);
        const ata   = getAssociatedTokenAddressSync(
            USDC_MINT, owner, false, TOKEN_PROGRAM_ID
        );
        const info  = await connection.getTokenAccountBalance(ata);
        return info.value.uiAmount ?? 0;
    } catch {
        // ATA doesn't exist yet — wallet has 0 balance
        return 0;
    }
}

// ─── Blockhash cache ──────────────────────────────────────────────────────────
//
// Avoids a 200ms RPC call on every transaction build.
// Blockhash is valid for ~60s on mainnet, we refresh every 30s.

class BlockhashCache {
    private blockhash            = "";
    private lastValidBlockHeight = 0;
    private fetchedAt            = 0;
    private readonly TTL         = 30_000;

    async get(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
        if (Date.now() - this.fetchedAt > this.TTL) {
            const result = await connection.getLatestBlockhash("confirmed");
            this.blockhash            = result.blockhash;
            this.lastValidBlockHeight = result.lastValidBlockHeight;
            this.fetchedAt            = Date.now();
        }
        return {
            blockhash:            this.blockhash,
            lastValidBlockHeight: this.lastValidBlockHeight,
        };
    }

    startWarmup() {
        this.get();
        setInterval(() => this.get(), 30_000);
    }
}

export const blockhashCache = new BlockhashCache();

// ─── ATA checks ───────────────────────────────────────────────────────────────

export async function checkAtaExists(
    address: string,
    mint: PublicKey | string = USDC_MINT
): Promise<boolean> {
    const mintKey = typeof mint === 'string' ? new PublicKey(mint) : mint;
    try {
        const owner = new PublicKey(address);
        const ata   = getAssociatedTokenAddressSync(mintKey, owner, false, TOKEN_PROGRAM_ID);
        await getAccount(connection, ata, "confirmed", TOKEN_PROGRAM_ID);
        return true;
    } catch {
        return false;
    }
}

export async function checkMultipleAtas(
    addresses: string[],
    mint: PublicKey | string = USDC_MINT
): Promise<Map<string, boolean>> {
    const mintKey = typeof mint === 'string' ? new PublicKey(mint) : mint;
    const results    = new Map<string, boolean>();
    const BATCH      = 100;

    for (let i = 0; i < addresses.length; i += BATCH) {
        const chunk      = addresses.slice(i, i + BATCH);
        const ataKeys    = chunk.map((addr) =>
            getAssociatedTokenAddressSync(
                mintKey, new PublicKey(addr), false, TOKEN_PROGRAM_ID
            )
        );

        const infos = await connection.getMultipleAccountsInfo(ataKeys);
        chunk.forEach((addr, idx) => {
            results.set(addr, infos[idx] !== null);
        });
    }

    return results;
}

export async function createMissingAtas(
    addresses: string[],
    mint: PublicKey | string = USDC_MINT,
    onProgress?: (created: number, total: number) => void
): Promise<void> {
    // Real ATA creation is handled by the backend pre-ATA pass
    // This function is a placeholder for frontend progress tracking
    // The backend /batches/prepare endpoint does the actual creation
    const PARALLEL = Math.min(addresses.length, 8);

    for (let i = 0; i < addresses.length; i += PARALLEL) {
        const chunk = addresses.slice(i, i + PARALLEL);
        await Promise.all(chunk.map(async (_, idx) => {
            await sleep(200);
            onProgress?.(Math.min(i + idx + 1, addresses.length), addresses.length);
        }));
    }
}

// ─── Transaction retry ────────────────────────────────────────────────────────

export async function sendWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries  = 3,
    baseDelayMs = 500
): Promise<T> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt === maxRetries - 1) throw err;
            await sleep(baseDelayMs * Math.pow(2, attempt));
        }
    }
    throw new Error("Max retries exceeded");
}

// ─── Address validation ───────────────────────────────────────────────────────

export function isValidSolanaAddress(address: string): boolean {
    try {
        new PublicKey(address);
        return true;
    } catch {
        return false;
    }
}

// ─── Program account helpers ──────────────────────────────────────────────────

export async function userAccountExists(
    walletPubkey: PublicKey,
    programId:    PublicKey
): Promise<boolean> {
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("useraccount"), walletPubkey.toBuffer()],
        programId
    );
    const info = await connection.getAccountInfo(pda);
    return info !== null;
}

export async function buildCreateAccountIx(
    program: Program<BulkPay>,
    wallet:  PublicKey
): Promise<TransactionInstruction> {
    return program.methods
        .createAccount()
        .accountsPartial({ owner: wallet })
        .instruction();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export function truncateAddress(address: string): string {
    if (address.length <= 12) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
