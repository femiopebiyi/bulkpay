// tests/helpers/scheduler.ts
//
// Shared helpers for all scheduler test suites.
// Wraps delegate, create_schedule, execute_schedule, close_schedule,
// close_delegation, and revoke_delegation instructions.

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import { BulkPay } from "../../../target/types/bulk_pay";
import { getProgram, getProvider, createFundedWallet, deriveUserAccount, deriveTransferLog } from "../../helpers/setup";
import { createUserAccount, initTransferLog } from "../../helpers/accounts";
import { createTestMint, createAtaWithBalance } from "../../helpers/tokens";

// ─── Re-export Recurrence enum values as plain objects ────────────────────────
// Anchor encodes enums as { once: {} } etc.
export const Recurrence = {
    Once: { once: {} },
    Daily: { daily: {} },
    Weekly: { weekly: {} },
    Monthly: { monthly: {} },
} as const;

// ─── PDA derivation ───────────────────────────────────────────────────────────

export function deriveDelegationAccount(
    sender: PublicKey,
    mint: PublicKey,
    programId: PublicKey
) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("delegation"), sender.toBuffer(), mint.toBuffer()],
        programId
    );
}

export function deriveScheduleAccount(
    sender: PublicKey,
    createdAt: number,
    programId: PublicKey
) {
    const createdAtBytes = Buffer.alloc(8);
    createdAtBytes.writeBigInt64LE(BigInt(createdAt));
    return PublicKey.findProgramAddressSync(
        [Buffer.from("schedule"), sender.toBuffer(), createdAtBytes],
        programId
    );
}

export function deriveSchedulerAuthority(programId: PublicKey) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("scheduler_authority")],
        programId
    );
}

// ─── Full suite context ───────────────────────────────────────────────────────

export interface SchedulerContext {
    sender: Keypair;
    executor: Keypair;  // backend wallet — pays fees for execute_schedule
    mint: PublicKey;
    senderAta: PublicKey;
    programId: PublicKey;
}

export async function bootstrapScheduler(
    program: Program<BulkPay>,
    connection: anchor.web3.Connection,
    senderSol = 0.2,
    executorSol = 0.2,
    senderTokens = 100_000_000_000n // 100,000 USDC
): Promise<SchedulerContext> {
    const sender = await createFundedWallet(connection, senderSol);
    const executor = await createFundedWallet(connection, executorSol);
    const mint = await createTestMint(connection, sender, 6, "legacy");
    const senderAta = await createAtaWithBalance(
        connection, sender, mint, sender.publicKey, senderTokens
    );

    await createUserAccount(program, sender);
    await initTransferLog(program, sender);

    return { sender, executor, mint, senderAta, programId: program.programId };
}

// ─── Instruction wrappers ─────────────────────────────────────────────────────

export async function callDelegate(
    program: Program<BulkPay>,
    ctx: SchedulerContext,
    maxAmount: bigint,
    expiresAt: number
): Promise<string> {
    const [delegationPda] = deriveDelegationAccount(
        ctx.sender.publicKey, ctx.mint, ctx.programId
    );
    const [schedulerAuthority] = deriveSchedulerAuthority(ctx.programId);

    return program.methods
        .delegate(new BN(maxAmount.toString()), new BN(expiresAt))
        .accountsPartial({
            sender: ctx.sender.publicKey,
            delegationAccount: delegationPda,
            senderAta: ctx.senderAta,
            schedulerAuthority,
            tokenMint: ctx.mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([ctx.sender])
        .rpc({ commitment: "confirmed" });
}

export async function callRevokeDelegation(
    program: Program<BulkPay>,
    ctx: SchedulerContext
): Promise<string> {
    const [delegationPda] = deriveDelegationAccount(
        ctx.sender.publicKey, ctx.mint, ctx.programId
    );

    return program.methods
        .revokeDelegation()
        .accountsPartial({
            sender: ctx.sender.publicKey,
            delegationAccount: delegationPda,
            senderAta: ctx.senderAta,
            tokenMint: ctx.mint,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.sender])
        .rpc({ commitment: "confirmed" });
}

export interface ScheduledRecipientInput {
    wallet: PublicKey;
    amount: bigint;
}

export async function callCreateSchedule(
    program: Program<BulkPay>,
    ctx: SchedulerContext,
    recipients: ScheduledRecipientInput[],
    recurrence: object,
    firstRunAt: number,
    maxRuns: number,
    createdAt?: number
): Promise<{ sig: string; createdAt: number; schedulePda: PublicKey }> {
    const ts = createdAt ?? Math.floor(Date.now() / 1000);

    const [delegationPda] = deriveDelegationAccount(
        ctx.sender.publicKey, ctx.mint, ctx.programId
    );
    const [schedulePda] = deriveScheduleAccount(ctx.sender.publicKey, ts, ctx.programId);

    const anchorRecipients = recipients.map((r) => ({
        wallet: r.wallet,
        amount: new BN(r.amount.toString()),
    }));

    const sig = await program.methods
        .createSchedule(
            anchorRecipients,
            recurrence as any,
            new BN(firstRunAt),
            maxRuns,
            new BN(ts)
        )
        .accountsPartial({
            sender: ctx.sender.publicKey,
            tokenMint: ctx.mint,
            delegationAccount: delegationPda,
            scheduleAccount: schedulePda,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.sender])
        .rpc({ commitment: "confirmed" });

    return { sig, createdAt: ts, schedulePda };
}

export async function callExecuteSchedule(
    program: Program<BulkPay>,
    ctx: SchedulerContext,
    createdAt: number,
    recipientAtas: PublicKey[]
): Promise<string> {
    const [delegationPda] = deriveDelegationAccount(
        ctx.sender.publicKey, ctx.mint, ctx.programId
    );
    const [schedulePda] = deriveScheduleAccount(
        ctx.sender.publicKey, createdAt, ctx.programId
    );
    const [schedulerAuthority] = deriveSchedulerAuthority(ctx.programId);
    const [transferLogPda] = deriveTransferLog(ctx.sender.publicKey, ctx.programId);
    const [userAccountPda] = deriveUserAccount(ctx.sender.publicKey, ctx.programId);

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 200_000 + recipientAtas.length * 35_000,
    });

    return program.methods
        .executeSchedule()
        .accountsPartial({
            executor: ctx.executor.publicKey,
            sender: ctx.sender.publicKey,
            scheduleAccount: schedulePda,
            delegationAccount: delegationPda,
            senderAta: ctx.senderAta,
            transferLog: transferLogPda,
            tokenMint: ctx.mint,
            schedulerAuthority,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(
            recipientAtas.map((ata) => ({
                pubkey: ata,
                isSigner: false,
                isWritable: true,
            }))
        )
        .preInstructions([computeIx])
        .signers([ctx.executor])
        .rpc({ commitment: "confirmed" });
}

export async function callCloseSchedule(
    program: Program<BulkPay>,
    ctx: SchedulerContext,
    createdAt: number
): Promise<string> {
    const [schedulePda] = deriveScheduleAccount(
        ctx.sender.publicKey, createdAt, ctx.programId
    );

    return program.methods
        .closeSchedule()
        .accountsPartial({
            sender: ctx.sender.publicKey,
            scheduleAccount: schedulePda,
        })
        .signers([ctx.sender])
        .rpc({ commitment: "confirmed" });
}

export async function callCloseDelegation(
    program: Program<BulkPay>,
    ctx: SchedulerContext
): Promise<string> {
    const [delegationPda] = deriveDelegationAccount(
        ctx.sender.publicKey, ctx.mint, ctx.programId
    );

    return program.methods
        .closeDelegation()
        .accountsPartial({
            sender: ctx.sender.publicKey,
            delegationAccount: delegationPda,
            senderAta: ctx.senderAta,
            tokenMint: ctx.mint,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.sender])
        .rpc({ commitment: "confirmed" });
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

export async function fetchDelegation(
    program: Program<BulkPay>,
    pda: PublicKey
) {
    return program.account.delegationAccount.fetch(pda, "confirmed");
}

export async function fetchSchedule(
    program: Program<BulkPay>,
    pda: PublicKey
) {
    return program.account.scheduleAccount.fetch(pda, "confirmed");
}

export async function getTokenAccountDelegate(
    connection: anchor.web3.Connection,
    ata: PublicKey
) {
    const info = await getAccount(connection, ata, "confirmed");
    return info.delegate ?? null;
}

// ─── Shared constants ─────────────────────────────────────────────────────────

export const ONE_USDC = 1_000_000;
export const ONE_DAY = 86_400;
export const ONE_WEEK = 604_800;
export const ONE_MONTH = 2_592_000;

export function futureTs(offsetSeconds = ONE_DAY): number {
    return Math.floor(Date.now() / 1000) + offsetSeconds;
}

export function pastTs(offsetSeconds = 60): number {
    return Math.floor(Date.now() / 1000) - offsetSeconds;
}
