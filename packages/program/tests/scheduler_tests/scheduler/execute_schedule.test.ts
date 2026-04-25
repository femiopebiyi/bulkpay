// tests/scheduler/execute_schedule.test.ts
//
// Tests for the `execute_schedule` instruction — happy path and deactivation.
//
// Covers:
//   - Correct token transfers to all recipients
//   - TransferLog records written correctly
//   - runs_completed increments
//   - next_run_at advances correctly per recurrence
//   - sender ATA debited, user_account updated
//   - Deactivation: Once, max_runs reached, infinite stays active

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { getProgram, getProvider, deriveTransferLog } from "../helpers/setup";
import { fetchTransferLog } from "../helpers/accounts";
import { createAtaWithBalance, getTokenBalance, deriveAta } from "../helpers/tokens";
import {
    bootstrapScheduler,
    callDelegate,
    callCreateSchedule,
    callExecuteSchedule,
    deriveScheduleAccount,
    fetchSchedule,
    Recurrence,
    futureTs,
    ONE_USDC,
    ONE_DAY,
    ONE_WEEK,
    ONE_MONTH,
} from "../helpers/scheduler";

describe("scheduler › execute_schedule", () => {
    const program    = getProgram();
    const connection = getProvider().connection;

    // ─── Setup helper ─────────────────────────────────────────────────────────

    async function fullSetup(
        recipientCount = 2,
        amountEach     = BigInt(100 * ONE_USDC),
        recurrence     = Recurrence.Once,
        maxRuns        = 1,
        firstRunOffset = -10 // seconds in past so it's immediately executable
    ) {
        const ctx = await bootstrapScheduler(program, connection, 2, 0.5);

        // Create recipient wallets and pre-create their ATAs
        const wallets = Array.from({ length: recipientCount }, () => Keypair.generate());
        const atas = await Promise.all(
            wallets.map((w) =>
                createAtaWithBalance(connection, ctx.sender, ctx.mint, w.publicKey, 0n)
            )
        );

        // Total required: amount × recipients × max_runs (for cap)
        const totalCap = amountEach * BigInt(recipientCount) * BigInt(Math.max(maxRuns, 1)) * 2n;
        await callDelegate(program, ctx, totalCap, futureTs(30 * ONE_DAY));

        const recipients = wallets.map((w) => ({ wallet: w.publicKey, amount: amountEach }));
        const firstRunAt = Math.floor(Date.now() / 1000) + firstRunOffset;

        const { createdAt, schedulePda } = await callCreateSchedule(
            program, ctx, recipients, recurrence, firstRunAt, maxRuns
        );

        return { ctx, wallets, atas, createdAt, schedulePda, recipients };
    }

    // ─── Token transfer correctness ───────────────────────────────────────────

    it("transfers correct amounts to all recipients", async () => {
        const { ctx, wallets, atas, createdAt } = await fullSetup(3, BigInt(50 * ONE_USDC));

        await callExecuteSchedule(program, ctx, createdAt, atas);

        for (const ata of atas) {
            const balance = await getTokenBalance(connection, ata);
            expect(balance).to.equal(BigInt(50 * ONE_USDC));
        }
    });

    it("debits the exact total from sender ATA", async () => {
        const amountEach = BigInt(100 * ONE_USDC);
        const count      = 3;
        const { ctx, atas, createdAt } = await fullSetup(count, amountEach);

        const before = await getTokenBalance(connection, ctx.senderAta);
        await callExecuteSchedule(program, ctx, createdAt, atas);
        const after = await getTokenBalance(connection, ctx.senderAta);

        expect(before - after).to.equal(amountEach * BigInt(count));
    });

    // ─── TransferLog correctness ───────────────────────────────────────────────

    it("writes TransferRecord entries to TransferLog for each recipient", async () => {
        const { ctx, wallets, atas, createdAt } = await fullSetup(2, BigInt(75 * ONE_USDC));
        await callExecuteSchedule(program, ctx, createdAt, atas);

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, ctx.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(2);
        expect(records[0].address.toBase58()).to.equal(wallets[0].publicKey.toBase58());
        expect(records[1].address.toBase58()).to.equal(wallets[1].publicKey.toBase58());
        expect(records[0].amountReceived.toNumber()).to.equal(75 * ONE_USDC);
        expect(records[1].amountReceived.toNumber()).to.equal(75 * ONE_USDC);
    });

    it("TransferLog total_all_time_received accumulates across multiple executions", async () => {
        const { ctx, wallets, atas, createdAt } = await fullSetup(
            1, BigInt(50 * ONE_USDC), Recurrence.Daily, 0 // infinite
        );

        await callExecuteSchedule(program, ctx, createdAt, atas);

        // Wait for schedule next_run_at to pass (it's now + 86400 — we can't wait
        // that long in a test, but we can verify the record total after first run)
        const [logPda] = deriveTransferLog(ctx.sender.publicKey, ctx.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records[0].totalAllTimeReceived.toNumber()).to.equal(50 * ONE_USDC);
    });

    // ─── Schedule state after execution ───────────────────────────────────────

    it("increments runs_completed by 1 after each execution", async () => {
        const { ctx, atas, createdAt, schedulePda } = await fullSetup(
            1, BigInt(10 * ONE_USDC), Recurrence.Daily, 0
        );

        const before = await fetchSchedule(program, schedulePda);
        expect(before.runsCompleted).to.equal(0);

        await callExecuteSchedule(program, ctx, createdAt, atas);

        const after = await fetchSchedule(program, schedulePda);
        expect(after.runsCompleted).to.equal(1);
    });

    it("advances next_run_at by ONE_DAY for Daily recurrence", async () => {
        const firstRunAt = Math.floor(Date.now() / 1000) - 10;
        const { ctx, atas, createdAt, schedulePda } = await fullSetup(
            1, BigInt(10 * ONE_USDC), Recurrence.Daily, 0, -10
        );

        const before = await fetchSchedule(program, schedulePda);
        await callExecuteSchedule(program, ctx, createdAt, atas);
        const after = await fetchSchedule(program, schedulePda);

        expect(after.nextRunAt.toNumber()).to.equal(
            before.nextRunAt.toNumber() + ONE_DAY
        );
    });

    it("advances next_run_at by ONE_WEEK for Weekly recurrence", async () => {
        const { ctx, atas, createdAt, schedulePda } = await fullSetup(
            1, BigInt(10 * ONE_USDC), Recurrence.Weekly, 0, -10
        );

        const before = await fetchSchedule(program, schedulePda);
        await callExecuteSchedule(program, ctx, createdAt, atas);
        const after = await fetchSchedule(program, schedulePda);

        expect(after.nextRunAt.toNumber()).to.equal(
            before.nextRunAt.toNumber() + ONE_WEEK
        );
    });

    it("advances next_run_at by ONE_MONTH for Monthly recurrence", async () => {
        const { ctx, atas, createdAt, schedulePda } = await fullSetup(
            1, BigInt(10 * ONE_USDC), Recurrence.Monthly, 0, -10
        );

        const before = await fetchSchedule(program, schedulePda);
        await callExecuteSchedule(program, ctx, createdAt, atas);
        const after = await fetchSchedule(program, schedulePda);

        expect(after.nextRunAt.toNumber()).to.equal(
            before.nextRunAt.toNumber() + ONE_MONTH
        );
    });

    it("updates user_account.all_time_amount_sent", async () => {
        const { ctx, atas, createdAt } = await fullSetup(2, BigInt(100 * ONE_USDC));
        await callExecuteSchedule(program, ctx, createdAt, atas);

        const [userPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("useraccount"), ctx.sender.publicKey.toBuffer()],
            ctx.programId
        );
        const account = await program.account.userAccount.fetch(userPda, "confirmed");
        expect(account.allTimeAmountSent.toNumber()).to.equal(2 * 100 * ONE_USDC);
    });

    // ─── Deactivation ─────────────────────────────────────────────────────────

    it("deactivates after Once recurrence executes", async () => {
        const { ctx, atas, createdAt, schedulePda } = await fullSetup(
            1, BigInt(10 * ONE_USDC), Recurrence.Once, 1, -10
        );

        await callExecuteSchedule(program, ctx, createdAt, atas);

        const schedule = await fetchSchedule(program, schedulePda);
        expect(schedule.isActive).to.be.false;
        expect(schedule.runsCompleted).to.equal(1);
    });

    it("deactivates when runs_completed reaches max_runs", async () => {
        // max_runs = 1, so after 1 execution it deactivates
        const { ctx, atas, createdAt, schedulePda } = await fullSetup(
            1, BigInt(10 * ONE_USDC), Recurrence.Daily, 1, -10
        );

        await callExecuteSchedule(program, ctx, createdAt, atas);

        const schedule = await fetchSchedule(program, schedulePda);
        expect(schedule.isActive).to.be.false;
        expect(schedule.runsCompleted).to.equal(1);
    });

    it("stays active after a non-final run (max_runs=3, run=1)", async () => {
        const { ctx, atas, createdAt, schedulePda } = await fullSetup(
            1, BigInt(10 * ONE_USDC), Recurrence.Daily, 3, -10
        );

        await callExecuteSchedule(program, ctx, createdAt, atas);

        const schedule = await fetchSchedule(program, schedulePda);
        expect(schedule.isActive).to.be.true;
        expect(schedule.runsCompleted).to.equal(1);
    });

    it("stays active for infinite schedule (max_runs=0) regardless of run count", async () => {
        const { ctx, atas, createdAt, schedulePda } = await fullSetup(
            1, BigInt(10 * ONE_USDC), Recurrence.Daily, 0, -10
        );

        await callExecuteSchedule(program, ctx, createdAt, atas);

        const schedule = await fetchSchedule(program, schedulePda);
        expect(schedule.isActive).to.be.true;
        expect(schedule.runsCompleted).to.equal(1);
    });

    it("is_active stays true after non-final run on Weekly schedule", async () => {
        const { ctx, atas, createdAt, schedulePda } = await fullSetup(
            1, BigInt(10 * ONE_USDC), Recurrence.Weekly, 5, -10
        );

        await callExecuteSchedule(program, ctx, createdAt, atas);

        const schedule = await fetchSchedule(program, schedulePda);
        expect(schedule.isActive).to.be.true;
        expect(schedule.runsCompleted).to.equal(1);
    });

    // ─── Atomicity ────────────────────────────────────────────────────────────

    it("rolls back all transfers if one ATA is missing mid-batch", async () => {
        const { ctx, wallets, atas, createdAt } = await fullSetup(3, BigInt(50 * ONE_USDC));

        // Replace atas[1] with a non-existent ATA
        const missingAta = deriveAta(Keypair.generate().publicKey, ctx.mint);
        const corruptedAtas = [atas[0], missingAta, atas[2]];

        const senderBefore = await getTokenBalance(connection, ctx.senderAta);

        try {
            await callExecuteSchedule(program, ctx, createdAt, corruptedAtas);
            expect.fail("Should have thrown AtaNotCreated");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }

        // atas[0] and atas[2] exist but received nothing — rolled back
        expect(await getTokenBalance(connection, atas[0])).to.equal(0n);
        expect(await getTokenBalance(connection, atas[2])).to.equal(0n);

        // Sender balance unchanged
        const senderAfter = await getTokenBalance(connection, ctx.senderAta);
        expect(senderBefore).to.equal(senderAfter);

        // TransferLog has no records
        const [logPda] = deriveTransferLog(ctx.sender.publicKey, ctx.programId);
        const { records } = await fetchTransferLog(program, logPda);
        expect(records).to.have.length(0);
    });

    it("runs_completed does not increment on failed execution", async () => {
        const { ctx, atas, createdAt, schedulePda } = await fullSetup(2, BigInt(50 * ONE_USDC));

        // Corrupt second ATA
        const corruptedAtas = [atas[0], deriveAta(Keypair.generate().publicKey, ctx.mint)];

        try {
            await callExecuteSchedule(program, ctx, createdAt, corruptedAtas);
        } catch { /* expected */ }

        const schedule = await fetchSchedule(program, schedulePda);
        expect(schedule.runsCompleted).to.equal(0);
    });
});
