// lib/transaction.ts
//
// Builds and sends bulk_transfer versioned transactions.
// Handles: prepare → ALT creation → build ix → sign → send → confirm

import {
    Connection,
    PublicKey,
    VersionedTransaction,
    TransactionMessage,
    AddressLookupTableProgram,
    AddressLookupTableAccount,
    ComputeBudgetProgram,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BulkPay } from "../../../../shared/types/bulk_pay";
import { connection, USDC_MINT } from "./solana";
import { authHeaders } from "./auth";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PreparedBatch {
    batch_id: string;        // was batchId
    atas: { wallet: string; ata_address: string; ata_exists: boolean }[];
    total_amount: number;        // was totalAmount
    atas_created: number;        // new field — how many ATAs the backend created
}

export interface RecipientForTx {
    wallet: string;
    ataAddress: string;
    amount: number; // in base units (e.g. USDC × 10^6)
}

// ── Step 1: Call backend to prepare batch + check ATAs ────────────────────────

export async function prepareBatch(
    recipients: { wallet: string; amount: number; name?: string; description?: string }[],
    mintAddress: string,
    notes?: string,
): Promise<PreparedBatch> {
    const res = await fetch(`${BASE}/batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
            recipients: recipients.map((r) => ({
                wallet: r.wallet,
                amount: r.amount,
                name: r.name,
                description: r.description,
            })),
            mint_address: mintAddress,
            notes,
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Prepare failed: ${err}`);
    }

    return res.json(); // Rust returns snake_case — interface now matches
}

// ── Step 2: Create + populate an Address Lookup Table ─────────────────────────

const ALT_CHUNK = 20; // max addresses per extend instruction

// lib/transaction.ts

// ── ALT cache helpers ─────────────────────────────────────────────────────────

function getStoredAltAddress(wallet: string): string | null {
    try { return localStorage.getItem(`bp_alt_${wallet}`); } catch { return null; }
}

function storeAltAddress(wallet: string, altAddress: string) {
    try { localStorage.setItem(`bp_alt_${wallet}`, altAddress); } catch { }
}

// ── Create or reuse ALT ───────────────────────────────────────────────────────

export async function createAndActivateALT(
    payer: PublicKey,
    signAndSend: (tx: VersionedTransaction) => Promise<string>,
    addresses: PublicKey[],
): Promise<AddressLookupTableAccount> {
    const walletKey = payer.toBase58();
    const stored = getStoredAltAddress(walletKey);

    let altAddress: PublicKey;
    let existingAddresses: Set<string> = new Set();

    if (stored) {
        // ── Reuse existing ALT ────────────────────────────────────────────────
        altAddress = new PublicKey(stored);

        const { value: existingAlt } = await connection.getAddressLookupTable(
            altAddress, { commitment: "confirmed" }
        );

        // Add this check after fetching the existing ALT
        if (existingAlt!.state.addresses.length + addresses.length > 256) {
            localStorage.removeItem(`bp_alt_${walletKey}`);
            return createAndActivateALT(payer, signAndSend, addresses);
        }

        if (!existingAlt) {
            // Stored ALT no longer exists on-chain (deactivated/closed) — clear cache
            localStorage.removeItem(`bp_alt_${walletKey}`);
            return createAndActivateALT(payer, signAndSend, addresses);
        }

        existingAddresses = new Set(
            existingAlt.state.addresses.map((a) => a.toBase58())
        );
    } else {
        // ── Create a new ALT ──────────────────────────────────────────────────
        const slot = await connection.getSlot("confirmed");

        const [createIx, newAltAddress] = AddressLookupTableProgram.createLookupTable({
            authority: payer,
            payer,
            recentSlot: slot - 1,
        });

        altAddress = newAltAddress;

        const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash("confirmed");

        const createTx = new VersionedTransaction(
            new TransactionMessage({
                payerKey: payer,
                recentBlockhash: blockhash,
                instructions: [createIx],
            }).compileToV0Message()
        );

        const createSig = await signAndSend(createTx);
        await connection.confirmTransaction(
            { signature: createSig, blockhash, lastValidBlockHeight },
            "confirmed"
        );

        storeAltAddress(walletKey, altAddress.toBase58());
    }

    // ── Extend with only addresses not already in the table ───────────────────
    const newAddresses = addresses.filter(
        (a) => !existingAddresses.has(a.toBase58())
    );

    for (let i = 0; i < newAddresses.length; i += ALT_CHUNK) {
        const chunk = newAddresses.slice(i, i + ALT_CHUNK);

        const extendIx = AddressLookupTableProgram.extendLookupTable({
            lookupTable: altAddress,
            authority: payer,
            payer,
            addresses: chunk,
        });

        const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash("confirmed");

        const extendTx = new VersionedTransaction(
            new TransactionMessage({
                payerKey: payer,
                recentBlockhash: blockhash,
                instructions: [extendIx],
            }).compileToV0Message()
        );

        const extendSig = await signAndSend(extendTx);
        await connection.confirmTransaction(
            { signature: extendSig, blockhash, lastValidBlockHeight },
            "confirmed"
        );
    }

    // Wait for ALT activation if anything was extended
    if (newAddresses.length > 0) {
        await new Promise((r) => setTimeout(r, 2000));
    }

    const { value: alt } = await connection.getAddressLookupTable(
        altAddress, { commitment: "confirmed" }
    );
    if (!alt) throw new Error("ALT not found after creation");
    return alt;
}

export async function ensureAccountsExist(
    program: Program<BulkPay>,
    sender: PublicKey,
    signAndSend: (tx: VersionedTransaction) => Promise<string>,
): Promise<void> {
    const [userAccountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("useraccount"), sender.toBuffer()],
        program.programId,
    );
    const [transferLogPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("transferlog"), sender.toBuffer()],
        program.programId,
    );

    const [userAccountInfo, transferLogInfo] = await Promise.all([
        connection.getAccountInfo(userAccountPda),
        connection.getAccountInfo(transferLogPda),
    ]);

    const needsUserAccount = userAccountInfo === null;
    const needsTransferLog = transferLogInfo === null;

    // ✅ Both already exist — skip entirely, no transaction needed
    if (!needsUserAccount && !needsTransferLog) return;

    const setupIxs: TransactionInstruction[] = [];

    if (needsUserAccount) {
        const ix = await program.methods
            .createAccount()
            .accountsPartial({ owner: sender })
            .instruction();
        setupIxs.push(ix);
    }

    if (needsTransferLog) {
        const ix = await program.methods
            .initTransferLog()
            .accountsPartial({ sender })
            .instruction();
        setupIxs.push(ix);
    }

    const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

    // ✅ Use legacy transaction for setup — versioned tx can cause simulation
    // failures for init instructions due to how Anchor resolves PDAs in v0 format
    const setupTx = new VersionedTransaction(
        new TransactionMessage({
            payerKey: sender,
            recentBlockhash: blockhash,
            instructions: setupIxs,
        }).compileToV0Message()
    );

    const sig = await signAndSend(setupTx);

    // ✅ Wait for confirmation before proceeding — ALT creation needs a clean state
    await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
    );
}
// ── Step 3: Build bulk_transfer versioned transaction ─────────────────────────

// lib/transaction.ts — replace buildBulkTransferTx with this corrected version
//
// Key fix: cuLimit was using 10_000 per recipient but the program sets
// BatchTooLarge at 35 recipients and the actual CU cost per recipient
// is ~10,500 (existing ATAs) or ~32,500 (new ATAs, but backend handles those now).
// Using 35_000 per recipient gives comfortable headroom.

export async function buildBulkTransferTx(
    program: Program<BulkPay>,
    sender: PublicKey,
    recipients: RecipientForTx[],
    alt: AddressLookupTableAccount | null,
): Promise<VersionedTransaction> {
    const [userAccountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("useraccount"), sender.toBuffer()],
        program.programId,
    );
    const [transferLogPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("transferlog"), sender.toBuffer()],
        program.programId,
    );

    const senderAta = getAssociatedTokenAddressSync(
        USDC_MINT, sender, false, TOKEN_PROGRAM_ID
    );

    const recipientArgs = recipients.map((r) => ({
        amountToBeReceived: new BN(r.amount),
    }));

    const remainingAccounts = recipients.map((r) => ({
        pubkey: new PublicKey(r.ataAddress),
        isSigner: false,
        isWritable: true,
    }));

    const cuLimit = Math.min(50_000 + recipients.length * 35_000, 1_400_000);

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit });
    const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 });

    const bulkIx = await program.methods
        .bulkTransfer(recipientArgs)
        .accountsPartial({
            sender,
            userAccount: userAccountPda,
            tokenMint: USDC_MINT,
            senderAtaToken: senderAta,
            transferLog: transferLogPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .instruction();

    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    const message = new TransactionMessage({
        payerKey: sender,
        recentBlockhash: blockhash,
        instructions: [computeIx, priorityIx, bulkIx],
    }).compileToV0Message(alt ? [alt] : []);

    return new VersionedTransaction(message);
}
// ── Step 4: Confirm batch with backend ────────────────────────────────────────

export async function confirmBatch(
    batchId: string,
    txSignature: string,
): Promise<void> {
    const res = await fetch(`${BASE}/batches/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ batch_id: batchId, tx_signature: txSignature }),
    });
    if (!res.ok) throw new Error("Failed to confirm batch with backend");
}


export async function failBatch(batchId: string): Promise<void> {
    try {
        await fetch(`${BASE}/batches/fail`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ batch_id: batchId }),
        });
    } catch {
        // Best effort — don't throw, we're already in error handling
    }
}
//scheduling
export interface ScheduleParams {
    recipients: { wallet: string; amount: number; name?: string; description?: string }[];
    recurrence: "once" | "daily" | "weekly" | "monthly";
    firstRunAt: Date;
    maxRuns: number;
    notes?: string;
}

// Anchor discriminators — sha256("global:<instruction_name>")[..8]
function discriminator(name: string): Buffer {
    const { createHash } = require("crypto");
    const hash = createHash("sha256").update(`global:${name}`).digest();
    return hash.slice(0, 8);
}

export async function buildDelegateIx(
    program: Program<BulkPay>,
    sender: PublicKey,
    maxAmount: bigint,
    expiresAt: number,
    createdAt: number,
): Promise<TransactionInstruction> {
    const [schedulerAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("scheduler_authority")],
        program.programId,
    );
    const senderAta = getAssociatedTokenAddressSync(USDC_MINT, sender, false, TOKEN_PROGRAM_ID);

    return program.methods
        .delegate(new BN(maxAmount.toString()), new BN(expiresAt), new BN(createdAt))
        .accountsPartial({
            sender,
            senderAta,
            schedulerAuthority,
            tokenMint: USDC_MINT,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            // ✅ delegationAccount removed — Anchor auto-derives from IDL arg seed
        })
        .instruction();
}

// ── Build create_schedule instruction ─────────────────────────────────────────

export async function buildCreateScheduleIx(
    program: Program<BulkPay>,
    sender: PublicKey,
    params: ScheduleParams,
    createdAt: number,
): Promise<{ ix: TransactionInstruction; schedulePda: PublicKey }> {
    const createdAtBuf = Buffer.alloc(8);
    createdAtBuf.writeBigInt64LE(BigInt(createdAt));

    // ✅ Must pass explicitly — IDL seed reads from account data, not arg
    const [delegationAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegation"), sender.toBuffer(), USDC_MINT.toBuffer(), createdAtBuf],
        program.programId,
    );

    // ✅ Needed to return schedulePda to the caller
    const [scheduleAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("schedule"), sender.toBuffer(), createdAtBuf],
        program.programId,
    );

    const onChainRecipients = params.recipients.map((r) => ({
        wallet: new PublicKey(r.wallet),
        amount: new BN(r.amount),
    }));

    const recurrenceEnum = {
        once:    { once: {} },
        daily:   { daily: {} },
        weekly:  { weekly: {} },
        monthly: { monthly: {} },
    }[params.recurrence];

    const firstRunAt = new BN(Math.floor(params.firstRunAt.getTime() / 1000));

    const ix = await program.methods
        .createSchedule(onChainRecipients, recurrenceEnum, firstRunAt, params.maxRuns, new BN(createdAt))
        .accountsPartial({
            sender,
            tokenMint: USDC_MINT,
            delegationAccount,          // ✅ must pass — cannot be auto-derived
            // scheduleAccount removed  — Anchor auto-derives from arg seed
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

    return { ix, schedulePda: scheduleAccount };
}


export async function submitSchedule(
    program: Program<BulkPay>,
    sender: PublicKey,
    params: ScheduleParams,
    signAndSend: (tx: VersionedTransaction) => Promise<string>,
    createdAt: number,
    maxAmount: bigint,
    expiresAt: number,
): Promise<{ schedulePda: string; createdAt: number }> {
    const ixs: TransactionInstruction[] = [];


    // Always delegate — each schedule gets its own DelegationAccount
    const delegateIx = await buildDelegateIx(
        program, sender, maxAmount, expiresAt, createdAt,
    );
    ixs.push(delegateIx);

    const { ix: scheduleIx, schedulePda } = await buildCreateScheduleIx(
        program, sender, params, createdAt,
    );
    ixs.push(scheduleIx);

    const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

    const tx = new VersionedTransaction(
        new TransactionMessage({
            payerKey: sender,
            recentBlockhash: blockhash,
            instructions: ixs,
        }).compileToV0Message()
    );

    const sig = await signAndSend(tx);
    await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
    );

    const accountInfo = await connection.getAccountInfo(schedulePda, "confirmed");
    if (!accountInfo || !accountInfo.owner.equals(program.programId)) {
        throw new Error("Schedule account not found at expected PDA");
    }

    return { schedulePda: schedulePda.toBase58(), createdAt };
}