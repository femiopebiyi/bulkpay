// tests/scheduler/create_schedule.test.ts
//
// Tests for the `create_schedule` instruction.
//
// Covers:
//   - Correct field storage
//   - PDA derivation using created_at seed
//   - Single-run and lifetime cap checks
//   - All rejection cases

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { getProgram, getProvider } from "../helpers/setup";
import {
    bootstrapScheduler,
    callDelegate,
    callCreateSchedule,
    callRevokeDelegation,
    deriveDelegationAccount,
    deriveScheduleAccount,
    fetchSchedule,
    Recurrence,
    futureTs,
    pastTs,
    ONE_USDC,
    ONE_DAY,
    ONE_WEEK,
} from "../helpers/scheduler";

describe("scheduler › create_schedule", () => {
    const program    = getProgram();
    const connection = getProvider().connection;

    // ─── Helpers ──────────────────────────────────────────────────────────────

    // Delegate and return a ready-to-schedule context
    async function setupWithDelegation(maxAmount = BigInt(100_000 * ONE_USDC)) {
        const ctx = await bootstrapScheduler(program, connection);
        await callDelegate(program, ctx, maxAmount, futureTs(30 * ONE_DAY));
        return ctx;
    }

    function makeRecipients(count: number, amount = BigInt(ONE_USDC)) {
        return Array.from({ length: count }, () => ({
            wallet: Keypair.generate().publicKey,
            amount,
        }));
    }

    // ─── Happy path ───────────────────────────────────────────────────────────

    it("creates ScheduleAccount with correct fields", async () => {
        const ctx        = await setupWithDelegation();
        const recipients = makeRecipients(2, BigInt(100 * ONE_USDC));
        const firstRunAt = futureTs(ONE_DAY);

        const { createdAt, schedulePda } = await callCreateSchedule(
            program, ctx,
            recipients,
            Recurrence.Weekly,
            firstRunAt,
            4 // max_runs
        );

        const schedule = await fetchSchedule(program, schedulePda);

        expect(schedule.owner.toBase58()).to.equal(ctx.sender.publicKey.toBase58());
        expect(schedule.mint.toBase58()).to.equal(ctx.mint.toBase58());
        expect(schedule.isActive).to.be.true;
        expect(schedule.runsCompleted).to.equal(0);
        expect(schedule.maxRuns).to.equal(4);
        expect(schedule.nextRunAt.toNumber()).to.equal(firstRunAt);
        expect(schedule.createdAt.toNumber()).to.equal(createdAt);
    });

    it("stores recurrence variant correctly — Once", async () => {
        const ctx        = await setupWithDelegation();
        const recipients = makeRecipients(1, BigInt(50 * ONE_USDC));

        const { schedulePda } = await callCreateSchedule(
            program, ctx, recipients, Recurrence.Once, futureTs(), 1
        );
        const schedule = await fetchSchedule(program, schedulePda);

        expect(schedule.recurrence).to.deep.equal(Recurrence.Once);
    });

    it("stores recurrence variant correctly — Daily", async () => {
        const ctx        = await setupWithDelegation();
        const recipients = makeRecipients(1, BigInt(10 * ONE_USDC));

        const { schedulePda } = await callCreateSchedule(
            program, ctx, recipients, Recurrence.Daily, futureTs(), 0
        );
        const schedule = await fetchSchedule(program, schedulePda);

        expect(schedule.recurrence).to.deep.equal(Recurrence.Daily);
    });

    it("stores recurrence variant correctly — Monthly", async () => {
        const ctx        = await setupWithDelegation();
        const recipients = makeRecipients(1, BigInt(10 * ONE_USDC));

        const { schedulePda } = await callCreateSchedule(
            program, ctx, recipients, Recurrence.Monthly, futureTs(), 0
        );
        const schedule = await fetchSchedule(program, schedulePda);

        expect(schedule.recurrence).to.deep.equal(Recurrence.Monthly);
    });

    it("stores all recipients correctly on-chain", async () => {
        const ctx = await setupWithDelegation();
        const wallets = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
        const recipients = wallets.map((kp) => ({
            wallet: kp.publicKey,
            amount: BigInt((wallets.indexOf(kp) + 1) * ONE_USDC),
        }));

        const { schedulePda } = await callCreateSchedule(
            program, ctx, recipients, Recurrence.Weekly, futureTs(), 0
        );
        const schedule = await fetchSchedule(program, schedulePda);

        expect(schedule.recipients).to.have.length(3);
        for (let i = 0; i < 3; i++) {
            expect(schedule.recipients[i].wallet.toBase58())
                .to.equal(wallets[i].publicKey.toBase58());
            expect(schedule.recipients[i].amount.toNumber())
                .to.equal((i + 1) * ONE_USDC);
        }
    });

    it("PDA is derived from [schedule, sender, created_at] — client can re-derive", async () => {
        const ctx        = await setupWithDelegation();
        const recipients = makeRecipients(1, BigInt(50 * ONE_USDC));
        const ts         = Math.floor(Date.now() / 1000);

        const { schedulePda } = await callCreateSchedule(
            program, ctx, recipients, Recurrence.Once, futureTs(), 1, ts
        );

        const [expectedPda] = deriveScheduleAccount(
            ctx.sender.publicKey, ts, ctx.programId
        );

        expect(schedulePda.toBase58()).to.equal(expectedPda.toBase58());
    });

    it("mint stored on schedule is not the default pubkey", async () => {
        const ctx        = await setupWithDelegation();
        const recipients = makeRecipients(1, BigInt(10 * ONE_USDC));

        const { schedulePda } = await callCreateSchedule(
            program, ctx, recipients, Recurrence.Daily, futureTs(), 0
        );
        const schedule = await fetchSchedule(program, schedulePda);

        expect(schedule.mint.toBase58()).to.not.equal(
            "11111111111111111111111111111111"
        );
        expect(schedule.mint.toBase58()).to.equal(ctx.mint.toBase58());
    });

    it("max_runs = 0 stores correctly (infinite schedule)", async () => {
        const ctx        = await setupWithDelegation();
        const recipients = makeRecipients(1, BigInt(10 * ONE_USDC));

        const { schedulePda } = await callCreateSchedule(
            program, ctx, recipients, Recurrence.Weekly, futureTs(), 0
        );
        const schedule = await fetchSchedule(program, schedulePda);

        expect(schedule.maxRuns).to.equal(0);
        expect(schedule.isActive).to.be.true;
    });

    // ─── Cap validation ───────────────────────────────────────────────────────

    it("rejects when single-run total exceeds delegation cap", async () => {
        const cap = BigInt(500 * ONE_USDC);
        const ctx = await bootstrapScheduler(program, connection);
        await callDelegate(program, ctx, cap, futureTs(30 * ONE_DAY));

        // Total = 600 USDC > 500 USDC cap
        const recipients = makeRecipients(6, BigInt(100 * ONE_USDC));

        try {
            await callCreateSchedule(
                program, ctx, recipients, Recurrence.Once, futureTs(), 1
            );
            expect.fail("Should have thrown ExceedsDelegationLimit");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    it("rejects when lifetime total (total × max_runs) exceeds delegation cap", async () => {
        const cap = BigInt(500 * ONE_USDC);
        const ctx = await bootstrapScheduler(program, connection);
        await callDelegate(program, ctx, cap, futureTs(30 * ONE_DAY));

        // Single run = 100 USDC, max_runs = 6 → lifetime = 600 USDC > 500 cap
        const recipients = makeRecipients(1, BigInt(100 * ONE_USDC));

        try {
            await callCreateSchedule(
                program, ctx, recipients, Recurrence.Weekly, futureTs(), 6
            );
            expect.fail("Should have thrown ExceedsDelegationLimit");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    it("accepts when lifetime total exactly equals delegation cap", async () => {
        // 100 USDC × 5 runs = 500 USDC = cap — should succeed
        const cap = BigInt(500 * ONE_USDC);
        const ctx = await bootstrapScheduler(program, connection);
        await callDelegate(program, ctx, cap, futureTs(30 * ONE_DAY));

        const recipients = makeRecipients(1, BigInt(100 * ONE_USDC));

        const { schedulePda } = await callCreateSchedule(
            program, ctx, recipients, Recurrence.Weekly, futureTs(), 5
        );
        const schedule = await fetchSchedule(program, schedulePda);
        expect(schedule.isActive).to.be.true;
    });

    it("for infinite schedules (max_runs=0), validates only single-run against cap", async () => {
        // Cap = 1000 USDC, single run = 200 USDC — should succeed even though
        // lifetime is technically unlimited
        const cap = BigInt(1_000 * ONE_USDC);
        const ctx = await bootstrapScheduler(program, connection);
        await callDelegate(program, ctx, cap, futureTs(30 * ONE_DAY));

        const recipients = makeRecipients(2, BigInt(100 * ONE_USDC));

        const { schedulePda } = await callCreateSchedule(
            program, ctx, recipients, Recurrence.Daily, futureTs(), 0
        );
        const schedule = await fetchSchedule(program, schedulePda);
        expect(schedule.isActive).to.be.true;
    });

    // ─── Rejection cases ──────────────────────────────────────────────────────

    it("rejects when delegation is inactive (revoked)", async () => {
        const ctx        = await setupWithDelegation();
        await callRevokeDelegation(program, ctx);
        const recipients = makeRecipients(1, BigInt(10 * ONE_USDC));

        try {
            await callCreateSchedule(
                program, ctx, recipients, Recurrence.Once, futureTs(), 1
            );
            expect.fail("Should have thrown DelegationInactive");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    it("rejects when first_run_at is in the past", async () => {
        const ctx        = await setupWithDelegation();
        const recipients = makeRecipients(1, BigInt(10 * ONE_USDC));

        try {
            await callCreateSchedule(
                program, ctx, recipients, Recurrence.Once, pastTs(60), 1
            );
            expect.fail("Should have thrown ScheduleNotDue");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    it("rejects when created_at is too far in the future (outside 60s window)", async () => {
        const ctx        = await setupWithDelegation();
        const recipients = makeRecipients(1, BigInt(10 * ONE_USDC));

        // created_at = now + 5 minutes — outside the +60s acceptance window
        const farFutureCreatedAt = Math.floor(Date.now() / 1000) + 400;

        try {
            await callCreateSchedule(
                program, ctx, recipients, Recurrence.Once, futureTs(), 1, farFutureCreatedAt
            );
            expect.fail("Should have thrown InvalidCreatedAt");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    it("rejects when created_at is too far in the past (outside 300s window)", async () => {
        const ctx        = await setupWithDelegation();
        const recipients = makeRecipients(1, BigInt(10 * ONE_USDC));

        // created_at = now - 10 minutes — outside the -300s acceptance window
        const farPastCreatedAt = Math.floor(Date.now() / 1000) - 700;

        try {
            await callCreateSchedule(
                program, ctx, recipients, Recurrence.Once, futureTs(), 1, farPastCreatedAt
            );
            expect.fail("Should have thrown InvalidCreatedAt");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });

    it("rejects when delegation owner doesn't match sender", async () => {
        const ctx      = await setupWithDelegation();
        const impostor = await (async () => {
            const sender = await require("../helpers/setup").createFundedWallet(connection, 0.5);
            return sender;
        })();

        const recipients = makeRecipients(1, BigInt(10 * ONE_USDC));
        const ts = Math.floor(Date.now() / 1000);

        const [delegationPda] = deriveDelegationAccount(
            ctx.sender.publicKey, ctx.mint, ctx.programId
        );
        const [schedulePda] = deriveScheduleAccount(impostor.publicKey, ts, ctx.programId);

        try {
            await program.methods
                .createSchedule(
                    recipients.map((r) => ({ wallet: r.wallet, amount: new BN(r.amount.toString()) })),
                    Recurrence.Once as any,
                    new BN(futureTs()),
                    1,
                    new BN(ts)
                )
                .accountsPartial({
                    sender:            impostor.publicKey,  // ← not the delegation owner
                    tokenMint:         ctx.mint,
                    delegationAccount: delegationPda,       // ← ctx.sender's delegation
                    scheduleAccount:   schedulePda,
                    systemProgram:     anchor.web3.SystemProgram.programId,
                    tokenProgram:      require("@solana/spl-token").TOKEN_PROGRAM_ID,
                })
                .signers([impostor])
                .rpc({ commitment: "confirmed" });

            expect.fail("Should have rejected — delegation owner mismatch");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });
});
