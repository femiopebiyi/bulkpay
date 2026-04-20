// tests/bulk_transfer/transfer_log.test.ts
//
// Extended correctness tests for the TransferLog account.
// Focus: things not covered in happy_path.test.ts Suite 3 —
//   - read_ata_owner correctness (v2-specific: address comes from ATA data, not caller)
//   - Multiple senders have independent, non-contaminating logs
//   - Record ordering is strictly FIFO across calls
//   - Running total is correct across complex call patterns
//   - Within-batch AND cross-call accumulation for the same recipient

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
    // ✅ getTokenBalance removed — not used in this file
} from "../helpers/tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecipientInput { amountToBeReceived: anchor.BN; }
interface SuiteContext { sender: Keypair; mint: PublicKey; senderAta: PublicKey; }

const DECIMALS = 6;
const FULL_BALANCE = 10_000_000_000n;
const ONE_USDC = 1_000_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function bootstrapSuite(
    program: ReturnType<typeof getProgram>,
    connection: anchor.web3.Connection,
    sol = 0.2
): Promise<SuiteContext> {
    const sender = await createFundedWallet(connection, sol);
    const mint = await createTestMint(connection, sender, DECIMALS, "legacy");
    const senderAta = await createAtaWithBalance(
        connection, sender, mint, sender.publicKey, FULL_BALANCE
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
        units: 50_000 + recipients.length * 35_000,
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

// ═══════════════════════════════════════════════════════════════════════════════
// Transfer log (extended) suite
// ═══════════════════════════════════════════════════════════════════════════════

describe("bulk_transfer › transfer log (extended)", () => {
    const program = getProgram();
    const connection = getProvider().connection;

    // ─── v2-specific: read_ata_owner correctness ───────────────────────────

    it("record.address is read from ATA bytes — never passed by the caller", async () => {
        // This is the core v2 guarantee. The caller only passes:
        //   - amount in instruction data
        //   - ATA pubkey in remaining_accounts
        // The program reads bytes 32..64 of the ATA account to get the wallet address.
        // If this is wrong, the record would have the wrong address — this test catches that.
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, recipient.publicKey, 0n
        );

        await callBulkTransfer(
            program, ctx,
            [{ amountToBeReceived: new anchor.BN(42 * ONE_USDC) }],
            [ata]
        );

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(1);
        // The record's address must be the ATA's actual owner — never passed by caller
        expect(records[0].address.toBase58()).to.equal(recipient.publicKey.toBase58());
        expect(records[0].amountReceived.toNumber()).to.equal(42 * ONE_USDC);
        expect(records[0].totalAllTimeReceived.toNumber()).to.equal(42 * ONE_USDC);
    });

    it("read_ata_owner correctly resolves different owners for different ATAs", async () => {
        // Verifies that read_ata_owner correctly distinguishes between
        // multiple different ATA owners in the same batch.
        const ctx = await bootstrapSuite(program, connection);

        const recipients = Array.from({ length: 3 }, () => Keypair.generate());
        const atas = await Promise.all(
            recipients.map((r) =>
                createAtaWithBalance(connection, ctx.sender, ctx.mint, r.publicKey, 0n)
            )
        );

        await callBulkTransfer(
            program, ctx,
            [
                { amountToBeReceived: new anchor.BN(10 * ONE_USDC) },
                { amountToBeReceived: new anchor.BN(20 * ONE_USDC) },
                { amountToBeReceived: new anchor.BN(30 * ONE_USDC) },
            ],
            atas
        );

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(3);
        for (let i = 0; i < 3; i++) {
            // Each record's address must match its corresponding ATA's owner
            expect(records[i].address.toBase58())
                .to.equal(recipients[i].publicKey.toBase58());
        }
    });

    // ─── Independent logs per sender ──────────────────────────────────────

    it("two senders have completely independent logs", async () => {
        const alice = await bootstrapSuite(program, connection);
        const bob = await bootstrapSuite(program, connection);

        // Use each sender's own mint so there's zero overlap
        const aliceRecipient = Keypair.generate();
        const bobRecipient = Keypair.generate();

        const aliceAta = await createAtaWithBalance(
            connection, alice.sender, alice.mint, aliceRecipient.publicKey, 0n
        );
        const bobAta = await createAtaWithBalance(
            connection, bob.sender, bob.mint, bobRecipient.publicKey, 0n
        );

        // ✅ first argument is always `program`, not the SuiteContext
        await callBulkTransfer(program, alice, [{ amountToBeReceived: new anchor.BN(100 * ONE_USDC) }], [aliceAta]);
        await callBulkTransfer(program, bob, [{ amountToBeReceived: new anchor.BN(200 * ONE_USDC) }], [bobAta]);

        const [aliceLogPda] = deriveTransferLog(alice.sender.publicKey, program.programId);
        const [bobLogPda] = deriveTransferLog(bob.sender.publicKey, program.programId);

        const aliceLog = await fetchTransferLog(program, aliceLogPda);
        const bobLog = await fetchTransferLog(program, bobLogPda);

        // Each has exactly 1 record
        expect(aliceLog.records).to.have.length(1);
        expect(bobLog.records).to.have.length(1);

        // Records reference the correct recipients
        expect(aliceLog.records[0].address.toBase58())
            .to.equal(aliceRecipient.publicKey.toBase58());
        expect(bobLog.records[0].address.toBase58())
            .to.equal(bobRecipient.publicKey.toBase58());

        // Amounts are correct and distinct
        expect(aliceLog.records[0].amountReceived.toNumber()).to.equal(100 * ONE_USDC);
        expect(bobLog.records[0].amountReceived.toNumber()).to.equal(200 * ONE_USDC);

        // No cross-contamination
        expect(aliceLog.records[0].address.toBase58())
            .to.not.equal(bobRecipient.publicKey.toBase58());
    });

    // ─── Record ordering ───────────────────────────────────────────────────

    it("records are strictly FIFO — ordered by call sequence across multiple calls", async () => {
        const ctx = await bootstrapSuite(program, connection);

        const r1 = Keypair.generate();
        const r2 = Keypair.generate();
        const r3 = Keypair.generate();

        const ata1 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r1.publicKey, 0n);
        const ata2 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r2.publicKey, 0n);
        const ata3 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r3.publicKey, 0n);

        // Three calls in sequence — distinct amounts for clear identification
        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(10 * ONE_USDC) }], [ata1]);
        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(20 * ONE_USDC) }], [ata2]);
        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(30 * ONE_USDC) }], [ata3]);

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(3);

        // Position 0 = first call, position 1 = second, position 2 = third
        expect(records[0].address.toBase58()).to.equal(r1.publicKey.toBase58());
        expect(records[1].address.toBase58()).to.equal(r2.publicKey.toBase58());
        expect(records[2].address.toBase58()).to.equal(r3.publicKey.toBase58());

        // Amounts confirm ordering — not just addresses
        expect(records[0].amountReceived.toNumber()).to.equal(10 * ONE_USDC);
        expect(records[1].amountReceived.toNumber()).to.equal(20 * ONE_USDC);
        expect(records[2].amountReceived.toNumber()).to.equal(30 * ONE_USDC);

        // Timestamps are monotonically non-decreasing
        expect(records[1].timestamp.toNumber())
            .to.be.gte(records[0].timestamp.toNumber());
        expect(records[2].timestamp.toNumber())
            .to.be.gte(records[1].timestamp.toNumber());
    });

    it("within-batch ordering is also preserved (left-to-right recipient order)", async () => {
        const ctx = await bootstrapSuite(program, connection);

        const r1 = Keypair.generate();
        const r2 = Keypair.generate();
        const r3 = Keypair.generate();

        const ata1 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r1.publicKey, 0n);
        const ata2 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r2.publicKey, 0n);
        const ata3 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r3.publicKey, 0n);

        // All three recipients in a single batch — order should match array order
        await callBulkTransfer(
            program, ctx,
            [
                { amountToBeReceived: new anchor.BN(10 * ONE_USDC) },
                { amountToBeReceived: new anchor.BN(20 * ONE_USDC) },
                { amountToBeReceived: new anchor.BN(30 * ONE_USDC) },
            ],
            [ata1, ata2, ata3]
        );

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(3);
        expect(records[0].address.toBase58()).to.equal(r1.publicKey.toBase58());
        expect(records[1].address.toBase58()).to.equal(r2.publicKey.toBase58());
        expect(records[2].address.toBase58()).to.equal(r3.publicKey.toBase58());
    });

    // ─── Running total correctness ─────────────────────────────────────────

    it("running total is correct across many calls with irregular amounts", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, recipient.publicKey, 0n
        );

        // Irregular amounts — verify cumulative total after each call
        const amounts = [7, 13, 42, 100, 3, 55, 1]; // total = 221 USDC
        for (const amt of amounts) {
            await callBulkTransfer(
                program, ctx,
                [{ amountToBeReceived: new anchor.BN(amt * ONE_USDC) }],
                [ata]
            );
        }

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(amounts.length);

        let runningTotal = 0;
        for (let i = 0; i < amounts.length; i++) {
            runningTotal += amounts[i] * ONE_USDC;
            expect(records[i].amountReceived.toNumber())
                .to.equal(amounts[i] * ONE_USDC);
            expect(records[i].totalAllTimeReceived.toNumber())
                .to.equal(runningTotal);
        }

        // Final record total = sum of all amounts
        expect(records[records.length - 1].totalAllTimeReceived.toNumber())
            .to.equal(221 * ONE_USDC);
    });

    it("within-batch totals accumulate before cross-call totals pick them up", async () => {
        // This test exercises the critical chain(new_records.iter()) fix.
        // Same recipient appears twice in one batch, then again in a second call.
        // The second call must see the full total from the first call (both entries).
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, recipient.publicKey, 0n
        );

        // Call 1: same recipient twice in one batch (10 + 20 = 30 USDC)
        await callBulkTransfer(
            program, ctx,
            [
                { amountToBeReceived: new anchor.BN(10 * ONE_USDC) },
                { amountToBeReceived: new anchor.BN(20 * ONE_USDC) },
            ],
            [ata, ata] // same ATA twice — same recipient
        );

        // Call 2: same recipient again (30 USDC)
        await callBulkTransfer(
            program, ctx,
            [{ amountToBeReceived: new anchor.BN(30 * ONE_USDC) }],
            [ata]
        );

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(3);

        // Record 0: first entry in call 1 — amount=10, total=10
        expect(records[0].amountReceived.toNumber()).to.equal(10 * ONE_USDC);
        expect(records[0].totalAllTimeReceived.toNumber()).to.equal(10 * ONE_USDC);

        // Record 1: second entry in call 1 — amount=20, total=30
        // Verifies same-batch accumulation: chain(new_records.iter()) sees record[0]
        expect(records[1].amountReceived.toNumber()).to.equal(20 * ONE_USDC);
        expect(records[1].totalAllTimeReceived.toNumber()).to.equal(30 * ONE_USDC);

        // Record 2: call 2 — amount=30, total=60
        // Verifies cross-call accumulation: transfer_log.records has records[0] and [1]
        expect(records[2].amountReceived.toNumber()).to.equal(30 * ONE_USDC);
        expect(records[2].totalAllTimeReceived.toNumber()).to.equal(60 * ONE_USDC);
    });

    it("multiple recipients with independent running totals in the same batch", async () => {
        // Two different recipients in the same batch — their running totals
        // must be tracked independently, not summed together.
        const ctx = await bootstrapSuite(program, connection);

        const r1 = Keypair.generate();
        const r2 = Keypair.generate();

        const ata1 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r1.publicKey, 0n);
        const ata2 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r2.publicKey, 0n);

        // Call 1: both in same batch
        await callBulkTransfer(
            program, ctx,
            [
                { amountToBeReceived: new anchor.BN(100 * ONE_USDC) },
                { amountToBeReceived: new anchor.BN(200 * ONE_USDC) },
            ],
            [ata1, ata2]
        );

        // Call 2: both again
        await callBulkTransfer(
            program, ctx,
            [
                { amountToBeReceived: new anchor.BN(50 * ONE_USDC) },
                { amountToBeReceived: new anchor.BN(75 * ONE_USDC) },
            ],
            [ata1, ata2]
        );

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(4);

        // r1: 100 → total 100
        expect(records[0].totalAllTimeReceived.toNumber()).to.equal(100 * ONE_USDC);
        // r2: 200 → total 200
        expect(records[1].totalAllTimeReceived.toNumber()).to.equal(200 * ONE_USDC);
        // r1: 50 → total 150 (100 + 50)
        expect(records[2].totalAllTimeReceived.toNumber()).to.equal(150 * ONE_USDC);
        // r2: 75 → total 275 (200 + 75)
        expect(records[3].totalAllTimeReceived.toNumber()).to.equal(275 * ONE_USDC);
    });
});