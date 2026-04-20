// tests/bulk_transfer/security.test.ts
//
// Verifies that the program's security constraints hold against:
//   - Cross-account injection (foreign user_account or transfer_log)
//   - ATA manipulation (wrong mint, non-ATA account, non-writable)
//
// In v2 the attack surface is smaller than v1 because:
//   - Wallets are never passed by the caller — read_ata_owner reads them from ATA data
//   - The ATA derivation check closes the spoofing window
//   - Seeds tie user_account and transfer_log to the signer's pubkey
//
// Each test verifies that:
//   (a) the transaction is rejected, AND
//   (b) the victim's on-chain state is untouched

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
    fetchUserAccount,
    fetchTransferLog,
} from "../helpers/accounts";
import {
    createTestMint,
    createAtaWithBalance,
    getTokenBalance,
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
    sol = 0.1
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

// Builds the raw instruction without sending — lets tests override specific accounts
async function buildBulkTransferIx(
    program: ReturnType<typeof getProgram>,
    sender: Keypair,
    userAccountPda: PublicKey,
    mint: PublicKey,
    senderAta: PublicKey,
    transferLogPda: PublicKey,
    recipients: RecipientInput[],
    atas: PublicKey[]
) {
    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 100_000 + recipients.length * 35_000,
    });

    return {
        computeIx,
        rpc: () =>
            program.methods
                .bulkTransfer(recipients)
                .accountsPartial({
                    sender: sender.publicKey,
                    userAccount: userAccountPda,
                    tokenMint: mint,
                    senderAtaToken: senderAta,
                    transferLog: transferLogPda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .remainingAccounts(
                    atas.map((ata) => ({ pubkey: ata, isSigner: false, isWritable: true }))
                )
                .preInstructions([computeIx])
                .signers([sender])
                .rpc({ commitment: "confirmed" }),
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Security suite
// ═══════════════════════════════════════════════════════════════════════════════

describe("bulk_transfer › security", () => {
    const program = getProgram();
    const connection = getProvider().connection;

    // ─── Cross-account injection ───────────────────────────────────────────

    it("rejects when user_account belongs to a different sender", async () => {
        // Attack: attacker tries to inflate victim's all_time_amount_sent
        // by substituting victim's user_account PDA into their own call.
        // Defence: seeds = [b"useraccount", sender.key()] — Anchor derives
        // the expected PDA from attacker's key, which ≠ victim's PDA → rejected.
        const attacker = await bootstrapSuite(program, connection);
        const victim = await createFundedWallet(connection);
        await createUserAccount(program, victim);

        const [victimUserAccountPda] = deriveUserAccount(victim.publicKey, program.programId);
        const [attackerLogPda] = deriveTransferLog(attacker.sender.publicKey, program.programId);

        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(
            connection, attacker.sender, attacker.mint, recipient.publicKey, 0n
        );

        try {
            await program.methods
                .bulkTransfer([{ amountToBeReceived: new anchor.BN(ONE_USDC) }])
                .accountsPartial({
                    sender: attacker.sender.publicKey,
                    userAccount: victimUserAccountPda, // ← wrong: victim's account
                    tokenMint: attacker.mint,
                    senderAtaToken: attacker.senderAta,
                    transferLog: attackerLogPda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .remainingAccounts([{ pubkey: ata, isSigner: false, isWritable: true }])
                .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 })])
                .signers([attacker.sender])
                .rpc({ commitment: "confirmed" });

            expect.fail("Should have rejected — seeds mismatch");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // Victim's all_time_amount_sent must still be 0
        const [victimPda] = deriveUserAccount(victim.publicKey, program.programId);
        const victimAccount = await fetchUserAccount(program, victimPda);
        expect(victimAccount.allTimeAmountSent.toNumber()).to.equal(0);
    });

    it("rejects when transfer_log belongs to a different sender", async () => {
        // Attack: attacker tries to write records into victim's transfer_log.
        // Defence: seeds = [b"transferlog", sender.key()] — derived from attacker,
        // which ≠ victim's log PDA → rejected.
        const attacker = await bootstrapSuite(program, connection);
        const victim = await createFundedWallet(connection);
        await createUserAccount(program, victim);
        await initTransferLog(program, victim);

        const [attackerUserPda] = deriveUserAccount(attacker.sender.publicKey, program.programId);
        const [victimLogPda] = deriveTransferLog(victim.publicKey, program.programId);

        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(
            connection, attacker.sender, attacker.mint, recipient.publicKey, 0n
        );

        try {
            await program.methods
                .bulkTransfer([{ amountToBeReceived: new anchor.BN(ONE_USDC) }])
                .accountsPartial({
                    sender: attacker.sender.publicKey,
                    userAccount: attackerUserPda,
                    tokenMint: attacker.mint,
                    senderAtaToken: attacker.senderAta,
                    transferLog: victimLogPda, // ← wrong: victim's log
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .remainingAccounts([{ pubkey: ata, isSigner: false, isWritable: true }])
                .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 })])
                .signers([attacker.sender])
                .rpc({ commitment: "confirmed" });

            expect.fail("Should have rejected — seeds mismatch");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // Victim's log must still be empty
        const { records } = await fetchTransferLog(program, victimLogPda);
        expect(records).to.have.length(0);
    });

    // ─── ATA manipulation attacks ──────────────────────────────────────────

    it("rejects ATA from a different mint — read_ata_owner + derivation check catches it", async () => {
        // Attack: pass an existing ATA for a different mint.
        // read_ata_owner correctly reads recipient.publicKey from the ATA bytes,
        // then derives expected_ata using ctx.mint → derives a DIFFERENT address
        // than wrongMintAta → InvalidAta.
        const ctx = await bootstrapSuite(program, connection);

        const mintB = await createTestMint(connection, ctx.sender, DECIMALS, "legacy");
        const recipient = Keypair.generate();
        const wrongMintAta = await createAtaWithBalance(
            connection, ctx.sender, mintB, recipient.publicKey, 0n
        );

        const [userAccountPda] = deriveUserAccount(ctx.sender.publicKey, program.programId);
        const [transferLogPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);

        try {
            await program.methods
                .bulkTransfer([{ amountToBeReceived: new anchor.BN(ONE_USDC) }])
                .accountsPartial({
                    sender: ctx.sender.publicKey,
                    userAccount: userAccountPda,
                    tokenMint: ctx.mint,
                    senderAtaToken: ctx.senderAta,
                    transferLog: transferLogPda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .remainingAccounts([{ pubkey: wrongMintAta, isSigner: false, isWritable: true }])
                .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 })])
                .signers([ctx.sender])
                .rpc({ commitment: "confirmed" });

            expect.fail("Should have thrown InvalidAta");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // No tokens left the sender's ATA
        const balance = await getTokenBalance(connection, ctx.senderAta);
        expect(balance).to.equal(FULL_BALANCE);
    });

    it("rejects a non-ATA account passed as an ATA — derivation mismatch", async () => {
        // Attack: pass an arbitrary existing account (the mint itself) as an ATA.
        // read_ata_owner reads bytes 32..64 of the mint account (not a valid token owner).
        // Derived expected_ata from those bytes ≠ mint address → InvalidAta.
        const ctx = await bootstrapSuite(program, connection);

        const [userAccountPda] = deriveUserAccount(ctx.sender.publicKey, program.programId);
        const [transferLogPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);

        try {
            await program.methods
                .bulkTransfer([{ amountToBeReceived: new anchor.BN(ONE_USDC) }])
                .accountsPartial({
                    sender: ctx.sender.publicKey,
                    userAccount: userAccountPda,
                    tokenMint: ctx.mint,
                    senderAtaToken: ctx.senderAta,
                    transferLog: transferLogPda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .remainingAccounts([
                    { pubkey: ctx.mint, isSigner: false, isWritable: true } // mint ≠ ATA
                ])
                .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 })])
                .signers([ctx.sender])
                .rpc({ commitment: "confirmed" });

            expect.fail("Should have thrown InvalidAta");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    it("rejects non-writable ATA — AtaNotWritable check fires before transfer", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, recipient.publicKey, 0n
        );

        const [userAccountPda] = deriveUserAccount(ctx.sender.publicKey, program.programId);
        const [transferLogPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);

        try {
            await program.methods
                .bulkTransfer([{ amountToBeReceived: new anchor.BN(ONE_USDC) }])
                .accountsPartial({
                    sender: ctx.sender.publicKey,
                    userAccount: userAccountPda,
                    tokenMint: ctx.mint,
                    senderAtaToken: ctx.senderAta,
                    transferLog: transferLogPda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .remainingAccounts([
                    { pubkey: ata, isSigner: false, isWritable: false } // ← not writable
                ])
                .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 })])
                .signers([ctx.sender])
                .rpc({ commitment: "confirmed" });

            expect.fail("Should have thrown AtaNotWritable");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // Recipient received nothing
        const recipientBalance = await getTokenBalance(connection, ata);
        expect(recipientBalance).to.equal(0n);
    });

    it("prevents a non-signer from initiating a transfer", async () => {
        // Anchor's Signer<'info> constraint ensures the sender must co-sign.
        // This test verifies that a third party cannot sign as someone else.
        const legitUser = await bootstrapSuite(program, connection);
        const attacker = await createFundedWallet(connection);

        const [userAccountPda] = deriveUserAccount(legitUser.sender.publicKey, program.programId);
        const [transferLogPda] = deriveTransferLog(legitUser.sender.publicKey, program.programId);

        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(
            connection, legitUser.sender, legitUser.mint, recipient.publicKey, 0n
        );

        try {
            // Attacker claims to be legitUser.sender but signs with their own keypair
            await program.methods
                .bulkTransfer([{ amountToBeReceived: new anchor.BN(ONE_USDC) }])
                .accountsPartial({
                    sender: legitUser.sender.publicKey, // claims to be legit user
                    userAccount: userAccountPda,
                    tokenMint: legitUser.mint,
                    senderAtaToken: legitUser.senderAta,
                    transferLog: transferLogPda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .remainingAccounts([{ pubkey: ata, isSigner: false, isWritable: true }])
                .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 })])
                .signers([attacker]) // ← attacker tries to sign instead of legit user
                .rpc({ commitment: "confirmed" });

            expect.fail("Should have rejected — signature mismatch");
        } catch (err: any) {
            expect(err.message).to.include("unknown");
        }

        // legit user's balance untouched
        const balance = await getTokenBalance(connection, legitUser.senderAta);
        expect(balance).to.equal(FULL_BALANCE);
    });
});