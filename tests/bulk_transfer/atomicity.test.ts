// tests/bulk_transfer/atomicity.test.ts

import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
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

function buildRemainingAccounts(wallets: PublicKey[], atas: PublicKey[]) {
    return wallets.flatMap((wallet, i) => [
        { pubkey: wallet, isSigner: false, isWritable: false },
        { pubkey: atas[i], isSigner: false, isWritable: true },
    ]);
}

async function callBulkTransfer(
    program: ReturnType<typeof getProgram>,
    ctx: SuiteContext,
    recipients: RecipientInput[],
    wallets: PublicKey[],
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
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(buildRemainingAccounts(wallets, atas))
        .preInstructions([computeIx])
        .signers([ctx.sender])
        .rpc({ commitment: "confirmed" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Atomicity tests
//
// Core guarantee: if ANY step in the loop fails, the ENTIRE transaction rolls
// back. No partial sends. No orphaned ATAs. Sender balance unchanged.
// ═══════════════════════════════════════════════════════════════════════════════

describe("bulk_transfer › atomicity", () => {
    const program = getProgram();
    const connection = getProvider().connection;

    // ─── Full rollback on invalid wallet mid-batch ──────────────────────────

    it("rolls back ALL transfers when an invalid wallet is mid-batch", async () => {
        const ctx = await bootstrapSuite(program, connection);

        const r1 = Keypair.generate(); // valid
        const r2 = Keypair.generate(); // valid — will be used as a bad wallet
        const r3 = Keypair.generate(); // valid

        const ata1 = deriveAta(r1.publicKey, ctx.mint);
        const ata2 = deriveAta(r2.publicKey, ctx.mint);
        const ata3 = deriveAta(r3.publicKey, ctx.mint);

        const senderBalanceBefore = await getTokenBalance(connection, ctx.senderAta);

        // Pass r1's ATA but swap in a random wallet key at position 1 —
        // the program will derive the ATA from the wrong wallet and reject it
        const badWallet = Keypair.generate().publicKey;

        try {
            await callBulkTransfer(
                program, ctx,
                [
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                ],
                [r1.publicKey, badWallet, r3.publicKey], // badWallet's ATA ≠ ata2
                [ata1, ata2, ata3]
            );
            expect.fail("Should have thrown — ATA derivation mismatch");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // All three recipients must have received nothing
        const bal1 = await connection.getAccountInfo(ata1);
        const bal3 = await connection.getAccountInfo(ata3);
        expect(bal1).to.be.null; // ATA was never created
        expect(bal3).to.be.null;

        // Sender's token balance unchanged
        const senderBalanceAfter = await getTokenBalance(connection, ctx.senderAta);
        expect(senderBalanceBefore).to.equal(senderBalanceAfter);
    });

    // ─── Full rollback on insufficient balance ──────────────────────────────

    it("rolls back ALL transfers when sender balance is insufficient", async () => {
        const ctx = await bootstrapSuite(program, connection);

        // Drain sender ATA to a small known amount — 5 USDC
        const smallBalance = 5_000_000n;
        const senderAtaInfo = await connection.getAccountInfo(ctx.senderAta);
        expect(senderAtaInfo).to.not.be.null;

        // Re-init with small balance by creating a fresh context
        const sender = await createFundedWallet(connection, 2);
        const mint = await createTestMint(connection, sender, DECIMALS, "legacy");
        const senderAta = await createAtaWithBalance(
            connection, sender, mint, sender.publicKey, smallBalance
        );
        await createUserAccount(program, sender);
        await initTransferLog(program, sender);
        const smallCtx = { sender, mint, senderAta };

        const r1 = Keypair.generate();
        const r2 = Keypair.generate();
        const r3 = Keypair.generate();

        // Total = 15 USDC > 5 USDC available — pre-flight check should reject
        try {
            await callBulkTransfer(
                program, smallCtx,
                [
                    { amountToBeReceived: new anchor.BN(5 * ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(5 * ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(5 * ONE_USDC) },
                ],
                [r1.publicKey, r2.publicKey, r3.publicKey],
                [deriveAta(r1.publicKey, mint), deriveAta(r2.publicKey, mint), deriveAta(r3.publicKey, mint)]
            );
            expect.fail("Should have thrown — InsufficientBalance");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // None of the ATAs should exist — tx rolled back before any CPI fired
        for (const r of [r1, r2, r3]) {
            const ataInfo = await connection.getAccountInfo(
                deriveAta(r.publicKey, mint), "confirmed"
            );
            expect(ataInfo).to.be.null;
        }

        // Sender's token balance unchanged
        const balanceAfter = await getTokenBalance(connection, senderAta);
        expect(balanceAfter).to.equal(smallBalance);
    });

    // ─── Full rollback on wrong account count ───────────────────────────────

    it("rolls back when remaining_accounts count does not match recipients × 2", async () => {
        const ctx = await bootstrapSuite(program, connection);

        const r1 = Keypair.generate();
        const r2 = Keypair.generate();

        const senderBalanceBefore = await getTokenBalance(connection, ctx.senderAta);

        try {
            await callBulkTransfer(
                program, ctx,
                [
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                ],
                [r1.publicKey],               // only 1 wallet for 2 recipients
                [deriveAta(r1.publicKey, ctx.mint)]
            );
            expect.fail("Should have thrown — InvalidAccountCount");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // r2 never received anything — tx rejected before loop
        const r2Ata = await connection.getAccountInfo(
            deriveAta(r2.publicKey, ctx.mint), "confirmed"
        );
        expect(r2Ata).to.be.null;

        const senderBalanceAfter = await getTokenBalance(connection, ctx.senderAta);
        expect(senderBalanceBefore).to.equal(senderBalanceAfter);
    });

    // ─── Successful batch does NOT roll back ────────────────────────────────

    it("does NOT roll back a fully valid batch", async () => {
        const ctx = await bootstrapSuite(program, connection);

        const recipients = Array.from({ length: 3 }, () => {
            const kp = Keypair.generate();
            return { keypair: kp, ata: deriveAta(kp.publicKey, ctx.mint) };
        });

        const senderBefore = await getTokenBalance(connection, ctx.senderAta);

        await callBulkTransfer(
            program, ctx,
            recipients.map(() => ({ amountToBeReceived: new anchor.BN(ONE_USDC) })),
            recipients.map((r) => r.keypair.publicKey),
            recipients.map((r) => r.ata)
        );

        // All recipients received funds
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

        const r1 = Keypair.generate();
        const badWallet = Keypair.generate().publicKey; // mismatched wallet
        const r3 = Keypair.generate();

        const ata1 = deriveAta(r1.publicKey, ctx.mint);
        const ata2 = deriveAta(r1.publicKey, ctx.mint); // wrong — derived from r1 not badWallet
        const ata3 = deriveAta(r3.publicKey, ctx.mint);

        try {
            await callBulkTransfer(
                program, ctx,
                [
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                ],
                [r1.publicKey, badWallet, r3.publicKey],
                [ata1, ata2, ata3]
            );
            expect.fail("Should have thrown");
        } catch {
            // expected
        }

        // Transfer log must still be empty — staged records are only flushed
        // after the entire loop succeeds
        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await await program.account.transferLog.fetch(logPda, "confirmed");
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

        const badWallet = Keypair.generate().publicKey;
        const r1 = Keypair.generate();

        try {
            await callBulkTransfer(
                program, ctx,
                [
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                ],
                [r1.publicKey, badWallet],
                [deriveAta(r1.publicKey, ctx.mint), deriveAta(r1.publicKey, ctx.mint)]
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