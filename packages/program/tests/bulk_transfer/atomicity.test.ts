// tests/bulk_transfer/atomicity.test.ts
//
// Core guarantee: if ANY step in the loop fails, the ENTIRE transaction rolls
// back. No partial sends. No orphaned state. Sender balance unchanged.

import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    // ✅ ASSOCIATED_TOKEN_PROGRAM_ID removed — no longer in BulkTransfer accounts struct
} from "@solana/spl-token";
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
    getTokenBalance,
    deriveAta,
} from "../helpers/tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecipientInput {
    amountToBeReceived: anchor.BN;
}

interface SuiteContext {
    sender: Keypair;
    mint: PublicKey;
    senderAta: PublicKey;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DECIMALS = 6;
const FULL_BALANCE = 10_000_000_000n;
const ONE_USDC = 1_000_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function bootstrapSuite(
    program: ReturnType<typeof getProgram>,
    connection: anchor.web3.Connection,
    solAmount = 0.5
): Promise<SuiteContext> {
    const sender = await createFundedWallet(connection, solAmount);
    const mint = await createTestMint(connection, sender, DECIMALS, "legacy");
    const senderAta = await createAtaWithBalance(
        connection, sender, mint, sender.publicKey, FULL_BALANCE
    );
    await createUserAccount(program, sender);
    await initTransferLog(program, sender);
    return { sender, mint, senderAta };
}

// v2: ATAs only — no wallets param, no associatedTokenProgram
function buildRemainingAccounts(atas: PublicKey[]) {
    return atas.map((ata) => ({ pubkey: ata, isSigner: false, isWritable: true }));
}

async function callBulkTransfer(
    program: ReturnType<typeof getProgram>,
    ctx: SuiteContext,
    recipients: RecipientInput[],
    atas: PublicKey[]  // ✅ ATAs only
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
            // ✅ no associatedTokenProgram
        })
        .remainingAccounts(buildRemainingAccounts(atas))
        .preInstructions([computeIx])
        .signers([ctx.sender])
        .rpc({ commitment: "confirmed" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Atomicity suite
// ═══════════════════════════════════════════════════════════════════════════════

describe("bulk_transfer › atomicity", () => {
    const program = getProgram();
    const connection = getProvider().connection;

    // ─── Full rollback on invalid ATA mid-batch ─────────────────────────────

    it("rolls back ALL transfers when an invalid ATA is mid-batch", async () => {
        // In v2, wallets are not passed — ATA validity is verified via read_ata_owner +
        // derivation check. To test mid-batch failure: pre-create positions 0 and 2,
        // leave position 1 non-existent → AtaNotCreated fires at index 1.
        const ctx = await bootstrapSuite(program, connection);

        const r1 = Keypair.generate();
        const r2 = Keypair.generate(); // ATA intentionally NOT created
        const r3 = Keypair.generate();

        const ata1 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r1.publicKey, 0n);
        const ata2 = deriveAta(r2.publicKey, ctx.mint); // non-existent → AtaNotCreated at index 1
        const ata3 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r3.publicKey, 0n);

        const senderBalanceBefore = await getTokenBalance(connection, ctx.senderAta);

        try {
            await callBulkTransfer(
                program, ctx,
                [
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                ],
                [ata1, ata2, ata3]
            );
            expect.fail("Should have thrown — AtaNotCreated at position 1");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // ata1 and ata3 exist (pre-created) but received nothing — transfer rolled back
        const bal1 = await getTokenBalance(connection, ata1);
        const bal3 = await getTokenBalance(connection, ata3);
        expect(bal1).to.equal(0n); // position 0 transfer was rolled back
        expect(bal3).to.equal(0n); // position 2 was never reached

        // ata2 was never created and still doesn't exist
        const ata2Info = await connection.getAccountInfo(ata2);
        expect(ata2Info).to.be.null;

        // Sender token balance unchanged
        const senderBalanceAfter = await getTokenBalance(connection, ctx.senderAta);
        expect(senderBalanceBefore).to.equal(senderBalanceAfter);
    });

    // ─── Full rollback on insufficient balance ──────────────────────────────

    it("rolls back ALL transfers when sender balance is insufficient", async () => {
        // The pre-flight balance check fires BEFORE the ATA existence loop,
        // so this test works even with non-existent ATAs.
        const sender = await createFundedWallet(connection, 2);
        const mint = await createTestMint(connection, sender, DECIMALS, "legacy");
        const senderAta = await createAtaWithBalance(
            connection, sender, mint, sender.publicKey, 5_000_000n // only 5 USDC
        );
        await createUserAccount(program, sender);
        await initTransferLog(program, sender);
        const smallCtx = { sender, mint, senderAta };

        const r1 = Keypair.generate();
        const r2 = Keypair.generate();
        const r3 = Keypair.generate();

        // Total = 15 USDC > 5 USDC — pre-flight InsufficientBalance fires before any CPI
        try {
            await callBulkTransfer(
                program, smallCtx,
                [
                    { amountToBeReceived: new anchor.BN(5 * ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(5 * ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(5 * ONE_USDC) },
                ],
                [
                    deriveAta(r1.publicKey, mint),
                    deriveAta(r2.publicKey, mint),
                    deriveAta(r3.publicKey, mint),
                ]
            );
            expect.fail("Should have thrown — InsufficientBalance");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // None of the ATAs were ever touched — balance check failed first
        for (const r of [r1, r2, r3]) {
            const ataInfo = await connection.getAccountInfo(
                deriveAta(r.publicKey, mint), "confirmed"
            );
            expect(ataInfo).to.be.null;
        }

        // Sender's token balance unchanged
        const balanceAfter = await getTokenBalance(connection, senderAta);
        expect(balanceAfter).to.equal(5_000_000n);
    });

    // ─── Full rollback on wrong account count ───────────────────────────────

    it("rolls back when remaining_accounts count does not match recipients count", async () => {
        // v2: 1 ATA per recipient — not 2 like v1
        const ctx = await bootstrapSuite(program, connection);

        const r1 = Keypair.generate();
        const ata1 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r1.publicKey, 0n);

        const senderBalanceBefore = await getTokenBalance(connection, ctx.senderAta);

        try {
            await callBulkTransfer(
                program, ctx,
                [
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                ],
                [ata1] // only 1 ATA for 2 recipients → InvalidAccountCount
            );
            expect.fail("Should have thrown — InvalidAccountCount");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // ata1 received nothing — rejected before loop
        const bal1 = await getTokenBalance(connection, ata1);
        expect(bal1).to.equal(0n);

        const senderBalanceAfter = await getTokenBalance(connection, ctx.senderAta);
        expect(senderBalanceBefore).to.equal(senderBalanceAfter);
    });

    // ─── Successful batch does NOT roll back ────────────────────────────────

    it("does NOT roll back a fully valid batch", async () => {
        const ctx = await bootstrapSuite(program, connection);

        // ✅ pre-create all ATAs — v2 requires them to exist
        const recipients = await Promise.all(
            Array.from({ length: 3 }, async () => {
                const kp = Keypair.generate();
                const ata = await createAtaWithBalance(
                    connection, ctx.sender, ctx.mint, kp.publicKey, 0n
                );
                return { keypair: kp, ata };
            })
        );

        const senderBefore = await getTokenBalance(connection, ctx.senderAta);

        await callBulkTransfer(
            program, ctx,
            recipients.map(() => ({ amountToBeReceived: new anchor.BN(ONE_USDC) })),
            recipients.map((r) => r.ata)
        );

        // All recipients received the correct amount
        for (const r of recipients) {
            const balance = await getTokenBalance(connection, r.ata);
            expect(balance).to.equal(BigInt(ONE_USDC));
        }

        // Sender debited by exactly the total
        const senderAfter = await getTokenBalance(connection, ctx.senderAta);
        expect(senderBefore - senderAfter).to.equal(BigInt(3 * ONE_USDC));
    });

    // ─── Transfer log is NOT written on failure ─────────────────────────────

    it("does not write any transfer log records when the batch fails", async () => {
        const ctx = await bootstrapSuite(program, connection);

        // Non-existent ATAs — AtaNotCreated fires at position 0.
        // Staged records are only flushed after the full loop succeeds, so log stays empty.
        const r1 = Keypair.generate();
        const r2 = Keypair.generate();
        const r3 = Keypair.generate();

        try {
            await callBulkTransfer(
                program, ctx,
                [
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                ],
                [
                    deriveAta(r1.publicKey, ctx.mint),
                    deriveAta(r2.publicKey, ctx.mint),
                    deriveAta(r3.publicKey, ctx.mint),
                ]
            );
            expect.fail("Should have thrown");
        } catch {
            // expected
        }

        // Transfer log must still be empty
        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await program.account.transferLog.fetch(logPda, "confirmed");
        expect(records).to.have.length(0);
    });

    // ─── user_account.all_time_amount_sent unchanged on failure ────────────

    it("does not increment all_time_amount_sent when the batch fails", async () => {
        const ctx = await bootstrapSuite(program, connection);

        const [userAccountPda] = deriveUserAccount(ctx.sender.publicKey, program.programId);

        const accountBefore = await program.account.userAccount.fetch(
            userAccountPda, "confirmed"
        );
        expect(accountBefore.allTimeAmountSent.toNumber()).to.equal(0);

        // Non-existent ATAs — AtaNotCreated fires, transaction rolls back entirely
        const r1 = Keypair.generate();
        const r2 = Keypair.generate();

        try {
            await callBulkTransfer(
                program, ctx,
                [
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                ],
                [
                    deriveAta(r1.publicKey, ctx.mint),
                    deriveAta(r2.publicKey, ctx.mint),
                ]
            );
            expect.fail("Should have thrown");
        } catch {
            // expected
        }

        const accountAfter = await program.account.userAccount.fetch(
            userAccountPda, "confirmed"
        );

        // Must be exactly 0 — no partial state written
        expect(accountAfter.allTimeAmountSent.toNumber()).to.equal(0);
    });
});