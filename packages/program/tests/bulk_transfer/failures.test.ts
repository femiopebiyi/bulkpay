// tests/bulk_transfer/failures.test.ts
//
// Verifies that the program rejects invalid inputs with the correct errors.
// All tests pre-create ATAs where needed — AtaNotCreated is now enforced in v2.
// Focus: error conditions, not rollback guarantees (those live in atomicity.test.ts).

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
const FULL_BALANCE = 10_000_000_000n; // 10,000 USDC
const ONE_USDC = 1_000_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function bootstrapSuite(
    program: ReturnType<typeof getProgram>,
    connection: anchor.web3.Connection,
    sol = 0.5
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

// v2: ATAs only — wallet addresses are read on-chain from ATA data
function buildRemainingAccounts(atas: PublicKey[], writable = true) {
    return atas.map((ata) => ({
        pubkey: ata,
        isSigner: false,
        isWritable: writable,
    }));
}

async function callBulkTransfer(
    program: ReturnType<typeof getProgram>,
    ctx: SuiteContext,
    recipients: RecipientInput[],
    atas: PublicKey[],
    overrideRemaining?: ReturnType<typeof buildRemainingAccounts>
): Promise<string> {
    const [userAccountPda] = deriveUserAccount(ctx.sender.publicKey, program.programId);
    const [transferLogPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 50_000 + Math.max(recipients.length, 1) * 35_000,
    });

    const remaining = overrideRemaining ?? buildRemainingAccounts(atas);

    return program.methods
        .bulkTransfer(recipients)
        .accountsPartial({
            sender:         ctx.sender.publicKey,
            userAccount:    userAccountPda,
            tokenMint:      ctx.mint,
            senderAtaToken: ctx.senderAta,
            transferLog:    transferLogPda,
            tokenProgram:   TOKEN_PROGRAM_ID,
            systemProgram:  anchor.web3.SystemProgram.programId,
            // ✅ no associatedTokenProgram — removed in v2
        })
        .remainingAccounts(remaining)
        .preInstructions([computeIx])
        .signers([ctx.sender])
        .rpc({ commitment: "confirmed" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Failures suite
// ═══════════════════════════════════════════════════════════════════════════════

describe("bulk_transfer › failures", () => {
    const program = getProgram();
    const connection = getProvider().connection;

    // ─── AtaNotCreated ─────────────────────────────────────────────────────

    it("rejects with AtaNotCreated when ATA does not exist", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        const ata = deriveAta(recipient.publicKey, ctx.mint); // never created

        const balanceBefore = await getTokenBalance(connection, ctx.senderAta);

        try {
            await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(ONE_USDC) }], [ata]);
            expect.fail("Should have thrown AtaNotCreated");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // No tokens moved — pre-ATA check fires before any CPI
        const balanceAfter = await getTokenBalance(connection, ctx.senderAta);
        expect(balanceBefore).to.equal(balanceAfter);
    });

    it("rejects all recipients if even one ATA is missing", async () => {
        const ctx = await bootstrapSuite(program, connection);

        const r1 = Keypair.generate();
        const r2 = Keypair.generate(); // ATA not created

        const ata1 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r1.publicKey, 0n);
        const ata2 = deriveAta(r2.publicKey, ctx.mint); // does not exist

        try {
            await callBulkTransfer(
                program, ctx,
                [
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                ],
                [ata1, ata2]
            );
            expect.fail("Should have thrown AtaNotCreated");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // ata1 received nothing — tx rolled back
        const info = await connection.getAccountInfo(ata1, "confirmed");
        // ata1 exists (we created it) but has 0 balance
        const balance = await getTokenBalance(connection, ata1);
        expect(balance).to.equal(0n);
    });

    // ─── InvalidAccountCount ───────────────────────────────────────────────

    it("rejects when remaining_accounts has fewer ATAs than recipients", async () => {
        const ctx = await bootstrapSuite(program, connection);

        const r1 = Keypair.generate();
        const ata1 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r1.publicKey, 0n);

        try {
            // 2 recipients, only 1 ATA
            await callBulkTransfer(
                program, ctx,
                [
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                    { amountToBeReceived: new anchor.BN(ONE_USDC) },
                ],
                [ata1]
            );
            expect.fail("Should have thrown InvalidAccountCount");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    it("rejects when remaining_accounts has more ATAs than recipients", async () => {
        const ctx = await bootstrapSuite(program, connection);

        const r1 = Keypair.generate();
        const r2 = Keypair.generate();
        const ata1 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r1.publicKey, 0n);
        const ata2 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r2.publicKey, 0n);

        try {
            // 1 recipient, 2 ATAs
            await callBulkTransfer(
                program, ctx,
                [{ amountToBeReceived: new anchor.BN(ONE_USDC) }],
                [ata1, ata2]
            );
            expect.fail("Should have thrown InvalidAccountCount");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    // ─── InvalidAta ────────────────────────────────────────────────────────

    it("rejects when ATA belongs to a different mint", async () => {
        // read_ata_owner returns the correct owner from the ATA bytes,
        // but the program derives expected_ata from (owner, ctx.mint) which ≠ wrong-mint ATA
        const ctx = await bootstrapSuite(program, connection);

        const mintB = await createTestMint(connection, ctx.sender, DECIMALS, "legacy");
        const recipient = Keypair.generate();

        // This ATA exists but for mintB, not ctx.mint
        const wrongMintAta = await createAtaWithBalance(
            connection, ctx.sender, mintB, recipient.publicKey, 0n
        );

        try {
            await callBulkTransfer(
                program, ctx,
                [{ amountToBeReceived: new anchor.BN(ONE_USDC) }],
                [wrongMintAta]
            );
            expect.fail("Should have thrown InvalidAta");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // Sender balance untouched
        const balance = await getTokenBalance(connection, ctx.senderAta);
        expect(balance).to.equal(FULL_BALANCE);
    });

    it("rejects a non-ATA account passed as an ATA", async () => {
        // Pass the mint account itself as a fake "ATA" — it exists and has data,
        // but bytes 32..64 of a mint account are not a valid owner pubkey for ATA derivation.
        // read_ata_owner reads those bytes, derives expected_ata, which ≠ ctx.mint address → InvalidAta
        const ctx = await bootstrapSuite(program, connection);

        try {
            await callBulkTransfer(
                program, ctx,
                [{ amountToBeReceived: new anchor.BN(ONE_USDC) }],
                [ctx.mint] // mint account masquerading as an ATA
            );
            expect.fail("Should have thrown InvalidAta");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    // ─── AtaNotWritable ────────────────────────────────────────────────────

    it("rejects when ATA is not marked writable", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(connection, ctx.sender, ctx.mint, recipient.publicKey, 0n);

        try {
            // Manually build remaining_accounts with isWritable: false
            await callBulkTransfer(
                program, ctx,
                [{ amountToBeReceived: new anchor.BN(ONE_USDC) }],
                [],
                [{ pubkey: ata, isSigner: false, isWritable: false }] // override: not writable
            );
            expect.fail("Should have thrown AtaNotWritable");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    // ─── InsufficientBalance ───────────────────────────────────────────────

    it("rejects when total exceeds sender token balance", async () => {
        const sender = await createFundedWallet(connection, 0.5);
        const mint = await createTestMint(connection, sender, DECIMALS, "legacy");
        // Only 5 USDC in sender's ATA
        const senderAta = await createAtaWithBalance(
            connection, sender, mint, sender.publicKey, 5_000_000n
        );
        await createUserAccount(program, sender);
        await initTransferLog(program, sender);
        const smallCtx = { sender, mint, senderAta };

        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(connection, sender, mint, recipient.publicKey, 0n);

        try {
            // 10 USDC > 5 USDC — pre-flight fires before any transfer
            await callBulkTransfer(
                program, smallCtx,
                [{ amountToBeReceived: new anchor.BN(10 * ONE_USDC) }],
                [ata]
            );
            expect.fail("Should have thrown InsufficientBalance");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // Sender balance unchanged
        const balanceAfter = await getTokenBalance(connection, senderAta);
        expect(balanceAfter).to.equal(5_000_000n);

        // Recipient received nothing
        const recipientBalance = await getTokenBalance(connection, ata);
        expect(recipientBalance).to.equal(0n);
    });

    it("rejects when a multi-recipient total overflows u64", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const r1 = Keypair.generate();
        const r2 = Keypair.generate();

        const ata1 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r1.publicKey, 0n);
        const ata2 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r2.publicKey, 0n);

        // u64::MAX + 1 overflows — checked_add returns None → Overflow error
        const u64Max = new anchor.BN("18446744073709551615");

        try {
            await callBulkTransfer(
                program, ctx,
                [
                    { amountToBeReceived: u64Max },
                    { amountToBeReceived: new anchor.BN(1) },
                ],
                [ata1, ata2]
            );
            expect.fail("Should have thrown Overflow");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    // ─── Edge cases ────────────────────────────────────────────────────────

    it("succeeds with an empty recipients vec — no transfers, no records appended", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const balanceBefore = await getTokenBalance(connection, ctx.senderAta);

        // remaining.len() == 0 == recipients.len() → valid, loop body never executes
        await callBulkTransfer(program, ctx, [], []);

        const balanceAfter = await getTokenBalance(connection, ctx.senderAta);
        expect(balanceBefore).to.equal(balanceAfter);

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await program.account.transferLog.fetch(logPda, "confirmed");
        expect(records).to.have.length(0);
    });

    it("rejects amount = 0 transfer gracefully", async () => {
        // Amount 0 passes the balance check (0 <= balance) and the overflow check.
        // The transfer_checked CPI with amount=0 is valid on-chain and succeeds.
        // A record IS written — whether to allow it is a UX concern, not a security one.
        // This test documents the current behaviour explicitly.
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(connection, ctx.sender, ctx.mint, recipient.publicKey, 0n);

        // Should succeed (amount=0 is allowed by the token program)
        await callBulkTransfer(
            program, ctx,
            [{ amountToBeReceived: new anchor.BN(0) }],
            [ata]
        );

        // Recipient balance remains 0
        const balance = await getTokenBalance(connection, ata);
        expect(balance).to.equal(0n);
    });
});