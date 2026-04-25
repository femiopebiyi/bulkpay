// tests/scheduler/close.test.ts
//
// Tests for `close_schedule` and `close_delegation` instructions.
//
// close_schedule:
//   - Closes completed schedule and returns rent
//   - Closes active schedule (cancellation) and emits ScheduleCancelled event
//   - Account ceases to exist after closure
//   - Rejects unauthorized callers
//
// close_delegation:
//   - Closes DelegationAccount and returns rent
//   - Revokes token delegate idempotently
//   - Rejects when is_active = true
//   - Rejects unauthorized callers

import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getProgram, getProvider, createFundedWallet } from "../helpers/setup";
import { createAtaWithBalance, getTokenBalance } from "../helpers/tokens";
import {
    bootstrapScheduler,
    callDelegate,
    callCreateSchedule,
    callExecuteSchedule,
    callRevokeDelegation,
    callCloseSchedule,
    callCloseDelegation,
    deriveDelegationAccount,
    deriveScheduleAccount,
    deriveSchedulerAuthority,
    fetchDelegation,
    fetchSchedule,
    getTokenAccountDelegate,
    Recurrence,
    futureTs,
    pastTs,
    ONE_USDC,
    ONE_DAY,
} from "../helpers/scheduler";

describe("scheduler › close_schedule", () => {
    const program    = getProgram();
    const connection = getProvider().connection;

    async function setupWithSchedule(
        recurrence = Recurrence.Once,
        maxRuns    = 1,
        firstRunOffset = -10
    ) {
        const ctx = await bootstrapScheduler(program, connection, 1, 0.5);

        const wallet = Keypair.generate();
        const ata    = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, wallet.publicKey, 0n
        );

        await callDelegate(program, ctx, BigInt(10_000 * ONE_USDC), futureTs(30 * ONE_DAY));

        const recipients = [{ wallet: wallet.publicKey, amount: BigInt(10 * ONE_USDC) }];
        const firstRunAt = Math.floor(Date.now() / 1000) + firstRunOffset;

        const { createdAt, schedulePda } = await callCreateSchedule(
            program, ctx, recipients, recurrence, firstRunAt, maxRuns
        );

        return { ctx, wallet, ata, createdAt, schedulePda };
    }

    // ─── Closing a completed schedule ─────────────────────────────────────────

    it("closes a completed schedule and account no longer exists", async () => {
        const { ctx, atas, ata, createdAt, schedulePda } = await setupWithSchedule();
        const [a] = [ata];

        // Execute → deactivates (Once)
        await callExecuteSchedule(program, ctx, createdAt, [a]);

        const solBefore = await connection.getBalance(ctx.sender.publicKey, "confirmed");
        await callCloseSchedule(program, ctx, createdAt);
        const solAfter = await connection.getBalance(ctx.sender.publicKey, "confirmed");

        // Rent returned to sender
        expect(solAfter).to.be.greaterThan(solBefore);

        // Account is gone
        const info = await connection.getAccountInfo(schedulePda);
        expect(info).to.be.null;
    });

    // ─── Cancellation (closing active schedule) ────────────────────────────────

    it("closes an active schedule (cancellation) — account no longer exists", async () => {
        // first_run_at = 1 hour in future → schedule is active but not yet due
        const { ctx, schedulePda, createdAt } = await setupWithSchedule(
            Recurrence.Daily, 0, 3_600
        );

        // Schedule is active (not yet run)
        const before = await fetchSchedule(program, schedulePda);
        expect(before.isActive).to.be.true;

        await callCloseSchedule(program, ctx, createdAt);

        const info = await connection.getAccountInfo(schedulePda);
        expect(info).to.be.null;
    });

    it("ScheduleCancelled event is emitted when closing an active schedule", async () => {
        const { ctx, schedulePda, createdAt } = await setupWithSchedule(
            Recurrence.Daily, 0, 3_600
        );

        // Listen for the event
        let eventFired = false;
        let capturedEvent: any = null;

        const listener = program.addEventListener("ScheduleCancelled", (event) => {
            eventFired = true;
            capturedEvent = event;
        });

        await callCloseSchedule(program, ctx, createdAt);

        // Give the listener time to fire
        await new Promise((r) => setTimeout(r, 2000));
        await program.removeEventListener(listener);

        expect(eventFired).to.be.true;
        expect(capturedEvent.owner.toBase58()).to.equal(ctx.sender.publicKey.toBase58());
        expect(capturedEvent.schedule.toBase58()).to.equal(schedulePda.toBase58());
        expect(capturedEvent.runsCompleted).to.equal(0);
    });

    it("ScheduleCancelled event is NOT emitted when closing a completed schedule", async () => {
        const { ctx, ata, createdAt } = await setupWithSchedule();

        await callExecuteSchedule(program, ctx, createdAt, [ata]);

        let eventFired = false;
        const listener = program.addEventListener("ScheduleCancelled", () => {
            eventFired = true;
        });

        await callCloseSchedule(program, ctx, createdAt);
        await new Promise((r) => setTimeout(r, 2000));
        await program.removeEventListener(listener);

        // Event should NOT fire for already-completed schedules
        expect(eventFired).to.be.false;
    });

    it("runs_completed is correct in ScheduleCancelled event after partial runs", async () => {
        // Daily, max_runs=5 — execute once, then cancel
        const { ctx, ata, createdAt, schedulePda } = await setupWithSchedule(
            Recurrence.Daily, 5, -10
        );

        await callExecuteSchedule(program, ctx, createdAt, [ata]);

        let capturedEvent: any = null;
        const listener = program.addEventListener("ScheduleCancelled", (e) => {
            capturedEvent = e;
        });

        await callCloseSchedule(program, ctx, createdAt);
        await new Promise((r) => setTimeout(r, 2000));
        await program.removeEventListener(listener);

        expect(capturedEvent).to.not.be.null;
        expect(capturedEvent.runsCompleted).to.equal(1);
    });

    // ─── Rejection cases ──────────────────────────────────────────────────────

    it("rejects when caller is not the schedule owner", async () => {
        const { ctx, schedulePda, createdAt } = await setupWithSchedule(
            Recurrence.Daily, 0, 3_600
        );
        const attacker = await createFundedWallet(connection);

        try {
            const [scheduleAcc] = deriveScheduleAccount(
                ctx.sender.publicKey, createdAt, ctx.programId
            );
            await program.methods
                .closeSchedule()
                .accountsPartial({
                    sender:          attacker.publicKey, // ← wrong owner
                    scheduleAccount: scheduleAcc,
                })
                .signers([attacker])
                .rpc({ commitment: "confirmed" });

            expect.fail("Should have rejected — not schedule owner");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // Schedule still exists
        const info = await connection.getAccountInfo(schedulePda);
        expect(info).to.not.be.null;
    });
});

// ─── close_delegation ─────────────────────────────────────────────────────────

describe("scheduler › close_delegation", () => {
    const program    = getProgram();
    const connection = getProvider().connection;

    it("closes DelegationAccount and account no longer exists", async () => {
        const ctx = await bootstrapScheduler(program, connection);
        await callDelegate(program, ctx, BigInt(1_000 * ONE_USDC), futureTs(30 * ONE_DAY));
        await callRevokeDelegation(program, ctx);

        const [delegationPda] = deriveDelegationAccount(
            ctx.sender.publicKey, ctx.mint, ctx.programId
        );

        const solBefore = await connection.getBalance(ctx.sender.publicKey, "confirmed");
        await callCloseDelegation(program, ctx);
        const solAfter  = await connection.getBalance(ctx.sender.publicKey, "confirmed");

        // Rent returned
        expect(solAfter).to.be.greaterThan(solBefore);

        // Account gone
        const info = await connection.getAccountInfo(delegationPda);
        expect(info).to.be.null;
    });

    it("revokes token delegate even if already revoked (idempotent CPI)", async () => {
        const ctx = await bootstrapScheduler(program, connection);
        await callDelegate(program, ctx, BigInt(1_000 * ONE_USDC), futureTs(30 * ONE_DAY));
        await callRevokeDelegation(program, ctx); // explicit revoke first

        // Verify delegate is already cleared
        const delegateBefore = await getTokenAccountDelegate(connection, ctx.senderAta);
        expect(delegateBefore).to.be.null;

        // close_delegation should succeed anyway — revoke CPI is idempotent
        await callCloseDelegation(program, ctx);

        // Delegate still null, no error
        // (Token program's revoke on an account with no delegate is a no-op)
    });

    it("rejects when delegation is still active (must revoke first)", async () => {
        const ctx = await bootstrapScheduler(program, connection);
        await callDelegate(program, ctx, BigInt(1_000 * ONE_USDC), futureTs(30 * ONE_DAY));

        // is_active = true — close_delegation should reject
        try {
            await callCloseDelegation(program, ctx);
            expect.fail("Should have thrown DelegationStillActive");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // Account still exists
        const [delegationPda] = deriveDelegationAccount(
            ctx.sender.publicKey, ctx.mint, ctx.programId
        );
        const info = await connection.getAccountInfo(delegationPda);
        expect(info).to.not.be.null;

        // is_active still true
        const delegation = await fetchDelegation(program, delegationPda);
        expect(delegation.isActive).to.be.true;
    });

    it("rejects when caller is not the delegation owner", async () => {
        const ctx      = await bootstrapScheduler(program, connection);
        const attacker = await createFundedWallet(connection);

        await callDelegate(program, ctx, BigInt(1_000 * ONE_USDC), futureTs(30 * ONE_DAY));
        await callRevokeDelegation(program, ctx);

        try {
            const [delegationPda] = deriveDelegationAccount(
                ctx.sender.publicKey, ctx.mint, ctx.programId
            );

            await program.methods
                .closeDelegation()
                .accountsPartial({
                    sender:            attacker.publicKey, // ← wrong owner
                    delegationAccount: delegationPda,
                    senderAta:         ctx.senderAta,
                    tokenMint:         ctx.mint,
                    tokenProgram:      TOKEN_PROGRAM_ID,
                })
                .signers([attacker])
                .rpc({ commitment: "confirmed" });

            expect.fail("Should have rejected — not delegation owner");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // Account still exists
        const [delegationPda] = deriveDelegationAccount(
            ctx.sender.publicKey, ctx.mint, ctx.programId
        );
        const info = await connection.getAccountInfo(delegationPda);
        expect(info).to.not.be.null;
    });
});
