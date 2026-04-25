// tests/scheduler/delegate.test.ts
//
// Tests for the `delegate` and `revoke_delegation` instructions.
//
// delegate:
//   - Creates DelegationAccount with correct fields
//   - Approves scheduler_authority PDA as delegate on sender's ATA
//   - Rejects invalid inputs
//   - Re-delegation overwrites previous delegation
//
// revoke_delegation:
//   - Sets is_active = false
//   - Clears the token account delegate field
//   - Rejects unauthorized callers

import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { getProgram, getProvider, createFundedWallet } from "../../helpers/setup";
import { createTestMint, createAtaWithBalance, getTokenBalance } from "../../helpers/tokens";
import { createUserAccount, initTransferLog } from "../../helpers/accounts";
import {
    bootstrapScheduler,
    callDelegate,
    callRevokeDelegation,
    deriveDelegationAccount,
    deriveSchedulerAuthority,
    fetchDelegation,
    getTokenAccountDelegate,
    futureTs,
    pastTs,
    ONE_USDC,
    ONE_DAY,
} from "../helpers/scheduler";

describe("scheduler › delegate", () => {
    const program = getProgram();
    const connection = getProvider().connection;

    // ─── Happy path ───────────────────────────────────────────────────────────

    it("creates DelegationAccount with correct fields", async () => {
        const ctx = await bootstrapScheduler(program, connection);
        const maxAmt = BigInt(1_000 * ONE_USDC);
        const expiry = futureTs(30 * ONE_DAY);

        await callDelegate(program, ctx, maxAmt, expiry);

        const [delegationPda] = deriveDelegationAccount(
            ctx.sender.publicKey, ctx.mint, ctx.programId
        );
        const delegation = await fetchDelegation(program, delegationPda);

        expect(delegation.owner.toBase58()).to.equal(ctx.sender.publicKey.toBase58());
        expect(delegation.mint.toBase58()).to.equal(ctx.mint.toBase58());
        expect(delegation.maxAmount.toString()).to.equal(maxAmt.toString());
        expect(delegation.expiresAt.toNumber()).to.equal(expiry);
        expect(delegation.isActive).to.be.true;
    });

    it("stores the correct bump in DelegationAccount", async () => {
        const ctx = await bootstrapScheduler(program, connection);

        await callDelegate(program, ctx, BigInt(500 * ONE_USDC), futureTs());

        const [delegationPda, expectedBump] = deriveDelegationAccount(
            ctx.sender.publicKey, ctx.mint, ctx.programId
        );
        const delegation = await fetchDelegation(program, delegationPda);

        expect(delegation.bump).to.equal(expectedBump);
    });

    it("sets scheduler_authority PDA as delegate on sender ATA", async () => {
        const ctx = await bootstrapScheduler(program, connection);

        await callDelegate(program, ctx, BigInt(1_000 * ONE_USDC), futureTs());

        const [schedulerAuthority] = deriveSchedulerAuthority(ctx.programId);
        const delegate = await getTokenAccountDelegate(connection, ctx.senderAta);

        expect(delegate).to.not.be.null;
        expect(delegate!.toBase58()).to.equal(schedulerAuthority.toBase58());
    });

    it("re-delegation overwrites max_amount and expires_at", async () => {
        const ctx = await bootstrapScheduler(program, connection);

        const firstMax = BigInt(500 * ONE_USDC);
        const firstExpiry = futureTs(7 * ONE_DAY);
        await callDelegate(program, ctx, firstMax, firstExpiry);

        const secondMax = BigInt(2_000 * ONE_USDC);
        const secondExpiry = futureTs(30 * ONE_DAY);
        await callDelegate(program, ctx, secondMax, secondExpiry);

        const [delegationPda] = deriveDelegationAccount(
            ctx.sender.publicKey, ctx.mint, ctx.programId
        );
        const delegation = await fetchDelegation(program, delegationPda);

        expect(delegation.maxAmount.toString()).to.equal(secondMax.toString());
        expect(delegation.expiresAt.toNumber()).to.equal(secondExpiry);
        expect(delegation.isActive).to.be.true;
    });

    it("re-delegation re-approves the token account with new max_amount", async () => {
        const ctx = await bootstrapScheduler(program, connection);

        await callDelegate(program, ctx, BigInt(500 * ONE_USDC), futureTs());
        await callDelegate(program, ctx, BigInt(2_000 * ONE_USDC), futureTs(30 * ONE_DAY));

        // delegate field should still be set to scheduler authority
        const [schedulerAuthority] = deriveSchedulerAuthority(ctx.programId);
        const delegate = await getTokenAccountDelegate(connection, ctx.senderAta);
        expect(delegate!.toBase58()).to.equal(schedulerAuthority.toBase58());
    });

    // ─── Rejection cases ──────────────────────────────────────────────────────

    it("rejects when expires_at is in the past", async () => {
        const ctx = await bootstrapScheduler(program, connection);

        try {
            await callDelegate(program, ctx, BigInt(1_000 * ONE_USDC), pastTs(60));
            expect.fail("Should have thrown DelegationExpired");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // DelegationAccount must not exist
        const [delegationPda] = deriveDelegationAccount(
            ctx.sender.publicKey, ctx.mint, ctx.programId
        );
        const info = await connection.getAccountInfo(delegationPda);
        expect(info).to.be.null;
    });

    it("rejects when max_amount is 0", async () => {
        const ctx = await bootstrapScheduler(program, connection);

        try {
            await callDelegate(program, ctx, 0n, futureTs());
            expect.fail("Should have thrown InvalidDelegationAmount");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    it("rejects when caller does not own the ATA", async () => {
        const ctx = await bootstrapScheduler(program, connection);
        const attacker = await createFundedWallet(connection);

        // Try to delegate using attacker keypair over ctx.sender's ATA
        try {
            const [delegationPda] = deriveDelegationAccount(
                ctx.sender.publicKey, ctx.mint, ctx.programId
            );
            const [schedulerAuthority] = deriveSchedulerAuthority(ctx.programId);

            await program.methods
                .delegate(new anchor.BN(1_000 * ONE_USDC), new anchor.BN(futureTs()))
                .accountsPartial({
                    sender: attacker.publicKey, // wrong signer
                    delegationAccount: delegationPda,
                    senderAta: ctx.senderAta,      // ctx.sender's ATA
                    schedulerAuthority,
                    tokenMint: ctx.mint,
                    tokenProgram: require("@solana/spl-token").TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([attacker])
                .rpc({ commitment: "confirmed" });

            expect.fail("Should have rejected — attacker not ATA authority");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // ctx.sender's ATA delegate must be untouched
        const delegate = await getTokenAccountDelegate(connection, ctx.senderAta);
        expect(delegate).to.be.null;
    });
});

// ─── revoke_delegation ────────────────────────────────────────────────────────

describe("scheduler › revoke_delegation", () => {
    const program = getProgram();
    const connection = getProvider().connection;

    it("sets is_active = false on DelegationAccount", async () => {
        const ctx = await bootstrapScheduler(program, connection);
        await callDelegate(program, ctx, BigInt(1_000 * ONE_USDC), futureTs());
        await callRevokeDelegation(program, ctx);

        const [delegationPda] = deriveDelegationAccount(
            ctx.sender.publicKey, ctx.mint, ctx.programId
        );
        const delegation = await fetchDelegation(program, delegationPda);

        expect(delegation.isActive).to.be.false;
    });

    it("clears the delegate field on the token account", async () => {
        const ctx = await bootstrapScheduler(program, connection);
        await callDelegate(program, ctx, BigInt(1_000 * ONE_USDC), futureTs());

        // Confirm delegate is set
        const before = await getTokenAccountDelegate(connection, ctx.senderAta);
        expect(before).to.not.be.null;

        await callRevokeDelegation(program, ctx);

        // Confirm delegate is cleared
        const after = await getTokenAccountDelegate(connection, ctx.senderAta);
        expect(after).to.be.null;
    });

    it("DelegationAccount still exists after revocation — not closed", async () => {
        const ctx = await bootstrapScheduler(program, connection);
        await callDelegate(program, ctx, BigInt(1_000 * ONE_USDC), futureTs());
        await callRevokeDelegation(program, ctx);

        const [delegationPda] = deriveDelegationAccount(
            ctx.sender.publicKey, ctx.mint, ctx.programId
        );
        const info = await connection.getAccountInfo(delegationPda);

        // Account exists — only is_active changed
        expect(info).to.not.be.null;
    });

    it("rejects when caller is not the delegation owner", async () => {
        const ctx = await bootstrapScheduler(program, connection);
        const attacker = await createFundedWallet(connection);

        await callDelegate(program, ctx, BigInt(1_000 * ONE_USDC), futureTs());

        try {
            const [delegationPda] = deriveDelegationAccount(
                ctx.sender.publicKey, ctx.mint, ctx.programId
            );

            await program.methods
                .revokeDelegation()
                .accountsPartial({
                    sender: attacker.publicKey, // wrong owner
                    delegationAccount: delegationPda,
                    senderAta: ctx.senderAta,
                    tokenMint: ctx.mint,
                    tokenProgram: require("@solana/spl-token").TOKEN_PROGRAM_ID,
                })
                .signers([attacker])
                .rpc({ commitment: "confirmed" });

            expect.fail("Should have rejected — not delegation owner");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // is_active must still be true
        const [delegationPda] = deriveDelegationAccount(
            ctx.sender.publicKey, ctx.mint, ctx.programId
        );
        const delegation = await fetchDelegation(program, delegationPda);
        expect(delegation.isActive).to.be.true;
    });
});
