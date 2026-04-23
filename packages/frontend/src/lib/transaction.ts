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
} from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BulkPay } from "../../../../shared/types/bulk_pay";
import { connection, USDC_MINT } from "./solana";
import { authHeaders } from "./auth";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PreparedBatch {
    batchId: string;
    atas: { wallet: string; ata_address: string; ata_exists: boolean }[];
    totalAmount: number;
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

    return res.json();
}

// ── Step 2: Create + populate an Address Lookup Table ─────────────────────────

const ALT_CHUNK = 20; // max addresses per extend instruction

export async function createAndActivateALT(
    payer: PublicKey,
    signAndSend: (tx: VersionedTransaction) => Promise<string>,
    addresses: PublicKey[],
): Promise<AddressLookupTableAccount> {
    const slot = await connection.getSlot("confirmed");

    // Create
    const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
        authority: payer,
        payer,
        recentSlot: slot - 1,
    });

    const { blockhash: bh1, lastValidBlockHeight: lbh1 } =
        await connection.getLatestBlockhash("confirmed");

    const createMsg = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: bh1,
        instructions: [createIx],
    }).compileToV0Message();

    const createTx = new VersionedTransaction(createMsg);
    await signAndSend(createTx);

    // Extend in chunks of 20
    for (let i = 0; i < addresses.length; i += ALT_CHUNK) {
        const chunk = addresses.slice(i, i + ALT_CHUNK);

        const extendIx = AddressLookupTableProgram.extendLookupTable({
            lookupTable: altAddress,
            authority: payer,
            payer,
            addresses: chunk,
        });

        const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash("confirmed");

        const extendMsg = new TransactionMessage({
            payerKey: payer,
            recentBlockhash: blockhash,
            instructions: [extendIx],
        }).compileToV0Message();

        const extendTx = new VersionedTransaction(extendMsg);
        await signAndSend(extendTx);
    }

    // Wait for ALT activation — mandatory 1 slot delay
    await new Promise((r) => setTimeout(r, 2000));

    const { value: alt } = await connection.getAddressLookupTable(altAddress, {
        commitment: "confirmed",
    });
    if (!alt) throw new Error("ALT not found after creation");
    return alt;
}

// ── Step 3: Build bulk_transfer versioned transaction ─────────────────────────

export async function buildBulkTransferTx(
    program: Program<BulkPay>,
    sender: PublicKey,
    recipients: RecipientForTx[],
    alt: AddressLookupTableAccount,
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

    // Amounts only — address comes from remaining_accounts (ATAs only, Option B)
    const recipientArgs = recipients.map((r) => ({
        amountToBeReceived: new BN(r.amount),
    }));

    // remaining_accounts = ATAs only
    const remainingAccounts = recipients.map((r) => ({
        pubkey: new PublicKey(r.ataAddress),
        isSigner: false,
        isWritable: true,
    }));

    const cuLimit = Math.min(50_000 + recipients.length * 10_000, 1_400_000);

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit });
    const priorityIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

    const bulkIx = await program.methods
        .bulkTransfer(recipientArgs)
        .accountsPartial({
            sender,
            userAccount: userAccountPda,
            tokenMint: USDC_MINT,
            senderAtaToken: senderAta,
            transferLog: transferLogPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: PublicKey.default,
        })
        .remainingAccounts(remainingAccounts)
        .instruction();

    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    const message = new TransactionMessage({
        payerKey: sender,
        recentBlockhash: blockhash,
        instructions: [computeIx, priorityIx, bulkIx],
    }).compileToV0Message([alt]);

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

// ── Setup: ensure UserAccount + TransferLog exist before bulk_transfer ────────
//
// Called once before the first bulk_transfer. If either PDA is missing,
// builds a setup transaction and has the user sign it once.
// Subsequent sends skip this — PDAs persist on-chain forever.

export async function ensureAccountsExist(
    program:     Program<BulkPay>,
    sender:      PublicKey,
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

    // Check both in parallel — single RPC round trip
    const [userAccountInfo, transferLogInfo] = await Promise.all([
        connection.getAccountInfo(userAccountPda),
        connection.getAccountInfo(transferLogPda),
    ]);

    const needsUserAccount  = userAccountInfo  === null;
    const needsTransferLog  = transferLogInfo  === null;

    // Both exist — nothing to do
    if (!needsUserAccount && !needsTransferLog) return;

    const setupIxs = [];

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

    // Bundle both into one transaction — user signs once
    const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

    const message = new TransactionMessage({
        payerKey:        sender,
        recentBlockhash: blockhash,
        instructions:    setupIxs,
    }).compileToV0Message();

    const setupTx = new VersionedTransaction(message);

    // Sign and send — wait for confirmation before proceeding to bulk_transfer
    const sig = await signAndSend(setupTx);
    await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed",
    );
}
