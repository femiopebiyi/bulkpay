// tests/bulk_transfer/realloc.test.ts
//
// Verifies that TransferLog grows correctly when records exceed capacity,
// rent is charged to the sender on growth, records are preserved across
// realloc boundaries, and the chunk strategy is applied.

import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
    getProgram,
    getProvider,
    createFundedWallet,
    deriveUserAccount,
    deriveTransferLog,
} from "../helpers/setup";
import {
    createUserAccount,
    initTransferLog,
    fetchTransferLog,
} from "../helpers/accounts";
import {
    createTestMint,
    createAtaWithBalance,
} from "../helpers/tokens";

// ─── Mirror state.rs constants — keep in sync ─────────────────────────────────

// v2: no name field — 32 (address) + 8 (amount) + 8 (total) + 8 (timestamp)
const TRANSFER_RECORD_LEN = 32 + 8 + 8 + 8; // 56 bytes
const BASE_LEN = 8 + 1 + 4;                  // 13 bytes (discriminator + bump + vec prefix)
const INITIAL_CAPACITY = 50;
const GROWTH_CHUNK = 50;

function spaceNeeded(recordCount: number): number {
    return BASE_LEN + recordCount * TRANSFER_RECORD_LEN;
}

function nextCapacity(currentLen: number, newRecords: number): number {
    const needed = currentLen + newRecords;
    const chunks = Math.ceil(needed / GROWTH_CHUNK);
    return chunks * GROWTH_CHUNK;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecipientInput { amountToBeReceived: anchor.BN; }
interface SuiteContext { sender: Keypair; mint: PublicKey; senderAta: PublicKey; }

const DECIMALS = 6;
const ONE_USDC = 1_000_000;
// Enough to send 10 USDC × 60 calls without refilling
const AMPLE_BALANCE = BigInt(10_000 * ONE_USDC);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function bootstrapSuite(
    program: ReturnType<typeof getProgram>,
    connection: anchor.web3.Connection,
    sol = 2 // realloc tests pay rent — needs more SOL than normal
): Promise<SuiteContext> {
    const sender = await createFundedWallet(connection, sol);
    const mint = await createTestMint(connection, sender, DECIMALS, "legacy");
    const senderAta = await createAtaWithBalance(
        connection, sender, mint, sender.publicKey, AMPLE_BALANCE
    );
    await createUserAccount(program, sender);
    await initTransferLog(program, sender);
    return { sender, mint, senderAta };
}

function buildRemainingAccounts(atas: PublicKey[]) {
    return atas.map((ata) => ({ pubkey: ata, isSigner: false, isWritable: true }));
}

async function callBulkTransfer(
    program: ReturnType<typeof getProgram>,
    ctx: SuiteContext,
    recipients: RecipientInput[],
    atas: PublicKey[]
): Promise<string> {
    const [userAccountPda] = deriveUserAccount(ctx.sender.publicKey, program.programId);
    const [transferLogPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 100_000 + recipients.length * 35_000,
    });

    return program.methods
        .bulkTransfer(recipients)
        .accountsPartial({
            sender: ctx.sender.publicKey,
            userAccount: userAccountPda,
            tokenMint: ctx.mint,
            senderAtaToken: ctx.senderAta,
            transferLog: transferLogPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(buildRemainingAccounts(atas))
        .preInstructions([computeIx])
        .signers([ctx.sender])
        .rpc({ commitment: "confirmed" });
}

/**
 * Pre-creates N ATAs and returns them.
 * Reuse these across multiple callBulkTransfer calls — they persist on devnet.
 */
async function createRecipientAtas(
    connection: anchor.web3.Connection,
    payer: Keypair,
    mint: PublicKey,
    count: number
): Promise<{ keypairs: Keypair[]; atas: PublicKey[] }> {
    const keypairs = Array.from({ length: count }, () => Keypair.generate());
    const atas = await Promise.all(
        keypairs.map((kp) =>
            createAtaWithBalance(connection, payer, mint, kp.publicKey, 0n)
        )
    );
    return { keypairs, atas };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Realloc suite
//
// Strategy: 5 calls × 10 recipients = 50 records (fills initial capacity exactly)
//           6th call × 1+ recipients = 51+ records → triggers first realloc
// ═══════════════════════════════════════════════════════════════════════════════

describe("bulk_transfer › realloc", () => {
    const program = getProgram();
    const connection = getProvider().connection;

    it("TransferLog is allocated at the correct initial space", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);

        const accountInfo = await connection.getAccountInfo(logPda, "confirmed");
        expect(accountInfo).to.not.be.null;

        const expectedSpace = spaceNeeded(INITIAL_CAPACITY);
        expect(accountInfo!.data.length).to.equal(expectedSpace); // 2,813 bytes
    });

    it("account grows when records exceed initial capacity", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);

        // 10 persistent recipients — reuse across 5 batches
        const { atas } = await createRecipientAtas(connection, ctx.sender, ctx.mint, 10);

        // 5 calls × 10 recipients = 50 records — fills initial capacity
        for (let i = 0; i < 5; i++) {
            await callBulkTransfer(
                program, ctx,
                Array.from({ length: 10 }, () => ({ amountToBeReceived: new anchor.BN(ONE_USDC) })),
                atas
            );
        }

        const before = await connection.getAccountInfo(logPda, "confirmed");
        expect(before!.data.length).to.equal(spaceNeeded(INITIAL_CAPACITY));
        const { records: recordsBefore } = await fetchTransferLog(program, logPda);
        expect(recordsBefore).to.have.length(50);

        // 51st record — triggers realloc
        const { atas: extraAtas } = await createRecipientAtas(connection, ctx.sender, ctx.mint, 1);
        await callBulkTransfer(
            program, ctx,
            [{ amountToBeReceived: new anchor.BN(ONE_USDC) }],
            extraAtas
        );

        const after = await connection.getAccountInfo(logPda, "confirmed");
        // Account grew — must be larger than initial size
        expect(after!.data.length).to.be.greaterThan(spaceNeeded(INITIAL_CAPACITY));
        // Must match the expected next-capacity size
        const expectedCapacity = nextCapacity(50, 1); // = 100
        expect(after!.data.length).to.equal(spaceNeeded(expectedCapacity));

        const { records: recordsAfter } = await fetchTransferLog(program, logPda);
        expect(recordsAfter).to.have.length(51);
    });

    it("uses chunk strategy — grows to 100-record boundary, not exact record count", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);

        const { atas } = await createRecipientAtas(connection, ctx.sender, ctx.mint, 10);

        // Fill to 50
        for (let i = 0; i < 5; i++) {
            await callBulkTransfer(
                program, ctx,
                Array.from({ length: 10 }, () => ({ amountToBeReceived: new anchor.BN(ONE_USDC) })),
                atas
            );
        }

        // Add 1 record → realloc should jump to 100-capacity, not 51
        const { atas: one } = await createRecipientAtas(connection, ctx.sender, ctx.mint, 1);
        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(ONE_USDC) }], one);

        const accountInfo = await connection.getAccountInfo(logPda, "confirmed");

        const exactSizeFor51 = spaceNeeded(51);
        const chunkSizeFor100 = spaceNeeded(100);

        // Must have grown to 100-record chunk boundary
        expect(accountInfo!.data.length).to.equal(chunkSizeFor100);
        // Must NOT have grown to exact 51-record size (that would mean no chunking)
        expect(accountInfo!.data.length).to.not.equal(exactSizeFor51);
    });

    it("records are fully preserved across a realloc boundary", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);

        const { keypairs, atas } = await createRecipientAtas(connection, ctx.sender, ctx.mint, 10);

        // Fill to exactly 50 with distinct amounts per batch
        for (let batch = 0; batch < 5; batch++) {
            await callBulkTransfer(
                program, ctx,
                Array.from({ length: 10 }, () => ({
                    amountToBeReceived: new anchor.BN((batch + 1) * ONE_USDC),
                })),
                atas
            );
        }

        // Snapshot the first and last records before realloc
        const { records: before } = await fetchTransferLog(program, logPda);
        const firstAddressBefore = before[0].address.toBase58();
        const firstAmountBefore = before[0].amountReceived.toNumber();
        const lastAmountBefore = before[49].amountReceived.toNumber();

        // Trigger realloc
        const { keypairs: [extra], atas: [extraAta] } =
            await createRecipientAtas(connection, ctx.sender, ctx.mint, 1);
        await callBulkTransfer(
            program, ctx,
            [{ amountToBeReceived: new anchor.BN(99 * ONE_USDC) }],
            [extraAta]
        );

        const { records: after } = await fetchTransferLog(program, logPda);

        // Original 50 records must be byte-for-byte identical
        expect(after[0].address.toBase58()).to.equal(firstAddressBefore);
        expect(after[0].amountReceived.toNumber()).to.equal(firstAmountBefore);
        expect(after[49].amountReceived.toNumber()).to.equal(lastAmountBefore);

        // 51st record is the new one
        expect(after[50].address.toBase58()).to.equal(extra.publicKey.toBase58());
        expect(after[50].amountReceived.toNumber()).to.equal(99 * ONE_USDC);
    });

    it("sender pays rent delta when account grows", async () => {
        const ctx = await bootstrapSuite(program, connection);

        const { atas } = await createRecipientAtas(connection, ctx.sender, ctx.mint, 10);

        // Fill to 50 records
        for (let i = 0; i < 5; i++) {
            await callBulkTransfer(
                program, ctx,
                Array.from({ length: 10 }, () => ({ amountToBeReceived: new anchor.BN(ONE_USDC) })),
                atas
            );
        }

        const solBefore = await connection.getBalance(ctx.sender.publicKey, "confirmed");

        // Trigger realloc
        const { atas: [extraAta] } = await createRecipientAtas(connection, ctx.sender, ctx.mint, 1);
        await callBulkTransfer(
            program, ctx,
            [{ amountToBeReceived: new anchor.BN(ONE_USDC) }],
            [extraAta]
        );

        const solAfter = await connection.getBalance(ctx.sender.publicKey, "confirmed");

        // Realloc from 2,813 → 5,613 bytes = 2,800 bytes × ~6,960 lamports/128 bytes
        // ≈ 152,250 lamports in rent delta, plus ~5,000 lamports tx fee
        // Total debit should be well above a regular tx fee (5,000 lamports)
        const delta = solBefore - solAfter;
        expect(delta).to.be.greaterThan(50_000); // meaningful rent was charged
    });

    it("second realloc (100 → 150) works correctly", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);

        // Get to 100 records: fill to 50, trigger first realloc, fill to 100
        const { atas: batch10 } = await createRecipientAtas(connection, ctx.sender, ctx.mint, 10);

        // 5 × 10 = 50 records
        for (let i = 0; i < 5; i++) {
            await callBulkTransfer(
                program, ctx,
                Array.from({ length: 10 }, () => ({ amountToBeReceived: new anchor.BN(ONE_USDC) })),
                batch10
            );
        }

        // 1 more record → realloc to 100 capacity
        const { atas: [first] } = await createRecipientAtas(connection, ctx.sender, ctx.mint, 1);
        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(ONE_USDC) }], [first]);

        // Fill from 51 → 100 records (49 more, uses same ATA batch)
        for (let i = 0; i < 4; i++) {
            await callBulkTransfer(
                program, ctx,
                Array.from({ length: 10 }, () => ({ amountToBeReceived: new anchor.BN(ONE_USDC) })),
                batch10
            );
        }

        // Verify at exactly 101 records — second realloc should fire (100 → 150 capacity)
        const { atas: [second] } = await createRecipientAtas(connection, ctx.sender, ctx.mint, 1);
        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(ONE_USDC) }], [second]);

        const accountInfo = await connection.getAccountInfo(logPda, "confirmed");
        const { records } = await fetchTransferLog(program, logPda);

        // 101 records written
        expect(records).to.have.length(101);
        // Account grew to 150-record chunk boundary
        expect(accountInfo!.data.length).to.equal(spaceNeeded(150));
    });
});