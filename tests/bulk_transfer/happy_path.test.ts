// tests/bulk_transfer/happy_path.test.ts

import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
    Keypair,
    PublicKey,
    ComputeBudgetProgram,
    AddressLookupTableProgram,
    TransactionMessage,
    VersionedTransaction,
    AddressLookupTableAccount,
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    mintTo,
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
    fetchUserAccount,
    fetchTransferLog,
} from "../helpers/accounts";
import {
    createTestMint,
    createAtaWithBalance,
    getTokenBalance,
    deriveAta,
} from "../helpers/tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

// Option B: address and name removed — amounts only in instruction data.
// Wallet addresses travel exclusively through remainingAccounts.
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
const REFILL_FLOOR = 1_000_000_000n;  // refill when below 1,000 USDC

// ─── Helpers ──────────────────────────────────────────────────────────────────

// wallets and atas are passed separately — address is no longer in RecipientInput
function buildRemainingAccounts(
    wallets: PublicKey[],
    atas: PublicKey[]
) {
    return wallets.flatMap((wallet, i) => [
        { pubkey: wallet, isSigner: false, isWritable: false },
        { pubkey: atas[i], isSigner: false, isWritable: true },
    ]);
}

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

async function refillSenderTokens(
    connection: anchor.web3.Connection,
    ctx: SuiteContext
): Promise<void> {
    const balance = await getTokenBalance(connection, ctx.senderAta);
    if (balance < REFILL_FLOOR) {
        await mintTo(
            connection,
            ctx.sender,
            ctx.mint,
            ctx.senderAta,
            ctx.sender,
            Number(FULL_BALANCE - balance),
            [],
            { commitment: "confirmed" },
            TOKEN_PROGRAM_ID
        );
    }
}

// wallets: the recipient wallet pubkeys for remainingAccounts
// atas: derived ATAs for each wallet
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

// Option B: instruction data is now 4 (vec prefix) + count * 8 (u64 only)
function estimateInstructionDataSize(count: number): number {
    return 4 + count * 8;
}

async function callBulkTransferV0(
    program: ReturnType<typeof getProgram>,
    connection: anchor.web3.Connection,
    ctx: SuiteContext,
    recipients: RecipientInput[],
    wallets: PublicKey[],
    atas: PublicKey[]
): Promise<string> {
    const estimatedDataSize = estimateInstructionDataSize(recipients.length);
    if (estimatedDataSize > 900) {
        throw new Error(
            `Instruction data too large: ~${estimatedDataSize} bytes. Reduce batch size.`
        );
    }

    const [userAccountPda] = deriveUserAccount(ctx.sender.publicKey, program.programId);
    const [transferLogPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);

    // All non-signer accounts go into the ALT — named + all recipient wallets/ATAs
    // sender is excluded: signers must remain in the static accounts section
    const allAltAddresses = [
        userAccountPda,
        ctx.mint,
        ctx.senderAta,
        transferLogPda,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
        anchor.web3.SystemProgram.programId,
        ...wallets.flatMap((w, i) => [w, atas[i]]),
    ];

    const lookupTable = await createAndActivateLookupTable(
        connection, ctx.sender, allAltAddresses
    );

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 50_000 + recipients.length * 35_000,
    });

    const bulkIx = await program.methods
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
        .instruction();

    const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

    const message = new TransactionMessage({
        payerKey: ctx.sender.publicKey,
        recentBlockhash: blockhash,
        instructions: [computeIx, bulkIx],
    }).compileToV0Message([lookupTable]);

    const tx = new VersionedTransaction(message);
    tx.sign([ctx.sender]);

    const sig = await connection.sendTransaction(tx, { skipPreflight: false });
    await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
    );
    return sig;
}

const ALT_EXTEND_CHUNK = 20;

async function createAndActivateLookupTable(
    connection: anchor.web3.Connection,
    payer: Keypair,
    addresses: PublicKey[]
): Promise<AddressLookupTableAccount> {
    const slot = await connection.getSlot("confirmed");

    const [createIx, lookupTableAddress] =
        AddressLookupTableProgram.createLookupTable({
            authority: payer.publicKey,
            payer: payer.publicKey,
            recentSlot: slot - 1,
        });

    const { blockhash: bh1, lastValidBlockHeight: lbh1 } =
        await connection.getLatestBlockhash("confirmed");

    const createMsg = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: bh1,
        instructions: [createIx],
    }).compileToV0Message();

    const createTx = new VersionedTransaction(createMsg);
    createTx.sign([payer]);

    const createSig = await connection.sendTransaction(createTx, { skipPreflight: false });
    await connection.confirmTransaction(
        { signature: createSig, blockhash: bh1, lastValidBlockHeight: lbh1 },
        "confirmed"
    );

    for (let i = 0; i < addresses.length; i += ALT_EXTEND_CHUNK) {
        const chunk = addresses.slice(i, i + ALT_EXTEND_CHUNK);

        const extendIx = AddressLookupTableProgram.extendLookupTable({
            lookupTable: lookupTableAddress,
            authority: payer.publicKey,
            payer: payer.publicKey,
            addresses: chunk,
        });

        const { blockhash: bh, lastValidBlockHeight: lbh } =
            await connection.getLatestBlockhash("confirmed");

        const extendMsg = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: bh,
            instructions: [extendIx],
        }).compileToV0Message();

        const extendTx = new VersionedTransaction(extendMsg);
        extendTx.sign([payer]);

        const extendSig = await connection.sendTransaction(extendTx, { skipPreflight: false });
        await connection.confirmTransaction(
            { signature: extendSig, blockhash: bh, lastValidBlockHeight: lbh },
            "confirmed"
        );
    }

    await new Promise((r) => setTimeout(r, 2000));

    const { value: lookupTable } = await connection.getAddressLookupTable(
        lookupTableAddress,
        { commitment: "confirmed" }
    );

    if (!lookupTable) throw new Error("Lookup table not found after creation");
    return lookupTable;
}

// Returns { keypair, input, ata } — input now only carries amountToBeReceived
function makeRecipients(
    count: number,
    mint: PublicKey,
    amountEach: number = ONE_USDC
) {
    return Array.from({ length: count }, () => {
        const keypair = Keypair.generate();
        return {
            keypair,
            input: { amountToBeReceived: new anchor.BN(amountEach) },
            ata: deriveAta(keypair.publicKey, mint),
        };
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 1 — Token transfers
// ═══════════════════════════════════════════════════════════════════════════════

describe("bulk_transfer › token transfers", () => {
    const program = getProgram();
    const connection = getProvider().connection;
    let ctx: SuiteContext;

    before(async () => { ctx = await bootstrapSuite(program, connection); });
    beforeEach(async () => { await refillSenderTokens(connection, ctx); });

    it("transfers the correct amount to a single recipient", async () => {
        const [r] = makeRecipients(1, ctx.mint, 100 * ONE_USDC);

        await callBulkTransfer(program, ctx, [r.input], [r.keypair.publicKey], [r.ata]);

        expect(await getTokenBalance(connection, r.ata)).to.equal(100_000_000n);
    });

    it("debits the exact amount from sender's ATA", async () => {
        const [r] = makeRecipients(1, ctx.mint, 250 * ONE_USDC);
        const before = await getTokenBalance(connection, ctx.senderAta);

        await callBulkTransfer(program, ctx, [r.input], [r.keypair.publicKey], [r.ata]);

        const after = await getTokenBalance(connection, ctx.senderAta);
        expect(before - after).to.equal(250_000_000n);
    });

    it("transfers correct individual amounts to multiple recipients", async () => {
        const recipients = makeRecipients(5, ctx.mint).map((r, i) => ({
            ...r,
            input: { amountToBeReceived: new anchor.BN((i + 1) * ONE_USDC) },
        }));

        await callBulkTransfer(
            program, ctx,
            recipients.map((r) => r.input),
            recipients.map((r) => r.keypair.publicKey),
            recipients.map((r) => r.ata)
        );

        for (const [i, r] of recipients.entries()) {
            expect(await getTokenBalance(connection, r.ata))
                .to.equal(BigInt((i + 1) * ONE_USDC));
        }
    });

    it("debits the exact total across multiple recipients", async () => {
        const amounts = [100, 200, 300]; // 600 USDC total
        const recipients = amounts.map((amt) => {
            const kp = Keypair.generate();
            return {
                keypair: kp,
                input: { amountToBeReceived: new anchor.BN(amt * ONE_USDC) },
                ata: deriveAta(kp.publicKey, ctx.mint),
            };
        });

        const before = await getTokenBalance(connection, ctx.senderAta);

        await callBulkTransfer(
            program, ctx,
            recipients.map((r) => r.input),
            recipients.map((r) => r.keypair.publicKey),
            recipients.map((r) => r.ata)
        );

        const after = await getTokenBalance(connection, ctx.senderAta);
        expect(before - after).to.equal(600_000_000n);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 2 — ATA lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("bulk_transfer › ATA lifecycle", () => {
    const program = getProgram();
    const connection = getProvider().connection;
    let ctx: SuiteContext;

    before(async () => { ctx = await bootstrapSuite(program, connection); });
    beforeEach(async () => { await refillSenderTokens(connection, ctx); });

    it("creates the recipient ATA when it does not exist", async () => {
        const [r] = makeRecipients(1, ctx.mint);

        const before = await connection.getAccountInfo(r.ata);
        expect(before).to.be.null;

        await callBulkTransfer(program, ctx, [r.input], [r.keypair.publicKey], [r.ata]);

        const after = await connection.getAccountInfo(r.ata, "confirmed");
        expect(after).to.not.be.null;
    });

    it("does not charge ATA rent when the ATA already exists", async () => {
        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, recipient.publicKey, 0n
        );

        const solBefore = await connection.getBalance(ctx.sender.publicKey, "confirmed");

        await callBulkTransfer(
            program, ctx,
            [{ amountToBeReceived: new anchor.BN(ONE_USDC) }],
            [recipient.publicKey],
            [ata]
        );

        const solAfter = await connection.getBalance(ctx.sender.publicKey, "confirmed");

        // Only tx fees (~5k lamports) — not ATA rent (~2,039,280 lamports)
        expect(solBefore - solAfter).to.be.lessThan(100_000);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 3 — Transfer log integrity
// Each test that asserts exact record counts bootstraps its own isolated sender.
// ═══════════════════════════════════════════════════════════════════════════════

describe("bulk_transfer › transfer log integrity", () => {
    const program = getProgram();
    const connection = getProvider().connection;

    it("appends exactly recipients.length records per call", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const batch = makeRecipients(3, ctx.mint);

        await callBulkTransfer(
            program, ctx,
            batch.map((r) => r.input),
            batch.map((r) => r.keypair.publicKey),
            batch.map((r) => r.ata)
        );

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);
        expect(records).to.have.length(3);
    });

    it("stores correct fields in each record", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        const ata = deriveAta(recipient.publicKey, ctx.mint);
        const txTime = Math.floor(Date.now() / 1000);

        await callBulkTransfer(
            program, ctx,
            [{ amountToBeReceived: new anchor.BN(42 * ONE_USDC) }],
            [recipient.publicKey],
            [ata]
        );

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const record = (await fetchTransferLog(program, logPda)).records[0];

        // name is now off-chain only — not present in TransferRecord
        expect(record.address.toBase58()).to.equal(recipient.publicKey.toBase58());
        expect(record.amountReceived.toNumber()).to.equal(42 * ONE_USDC);
        expect(record.totalAllTimeReceived.toNumber()).to.equal(42 * ONE_USDC);
        expect(Math.abs(record.timestamp.toNumber() - txTime)).to.be.lessThan(30);
    });

    it("accumulates total_all_time_received across calls for the same recipient", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        const ata = deriveAta(recipient.publicKey, ctx.mint);
        const amount = new anchor.BN(50 * ONE_USDC);

        await callBulkTransfer(program, ctx, [{ amountToBeReceived: amount }], [recipient.publicKey], [ata]);
        await callBulkTransfer(program, ctx, [{ amountToBeReceived: amount }], [recipient.publicKey], [ata]);

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(2);
        expect(records[0].totalAllTimeReceived.toNumber()).to.equal(50 * ONE_USDC);
        expect(records[1].totalAllTimeReceived.toNumber()).to.equal(100 * ONE_USDC);
    });

    it("preserves previous records — new records are appended not overwritten", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const r1 = Keypair.generate();
        const r2 = Keypair.generate();

        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(ONE_USDC) }], [r1.publicKey], [deriveAta(r1.publicKey, ctx.mint)]);
        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(ONE_USDC) }], [r2.publicKey], [deriveAta(r2.publicKey, ctx.mint)]);

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(2);
        // verify by address since name is now off-chain
        expect(records[0].address.toBase58()).to.equal(r1.publicKey.toBase58());
        expect(records[1].address.toBase58()).to.equal(r2.publicKey.toBase58());
    });

    it("correctly handles same recipient appearing twice in one batch", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        const ata = deriveAta(recipient.publicKey, ctx.mint);
        const amount = new anchor.BN(10 * ONE_USDC);

        await callBulkTransfer(
            program, ctx,
            [{ amountToBeReceived: amount }, { amountToBeReceived: amount }],
            [recipient.publicKey, recipient.publicKey],
            [ata, ata]
        );

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(2);
        expect(records[0].totalAllTimeReceived.toNumber()).to.equal(10 * ONE_USDC);
        // second entry must chain off the first — verifies the same-batch accumulation fix
        expect(records[1].totalAllTimeReceived.toNumber()).to.equal(20 * ONE_USDC);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4 — UserAccount state
// ═══════════════════════════════════════════════════════════════════════════════

describe("bulk_transfer › user account state", () => {
    const program = getProgram();
    const connection = getProvider().connection;

    it("updates all_time_amount_sent by the correct total", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const recipients = makeRecipients(2, ctx.mint, 100 * ONE_USDC);

        await callBulkTransfer(
            program, ctx,
            recipients.map((r) => r.input),
            recipients.map((r) => r.keypair.publicKey),
            recipients.map((r) => r.ata)
        );

        const [userAccountPda] = deriveUserAccount(ctx.sender.publicKey, program.programId);
        const account = await fetchUserAccount(program, userAccountPda);
        expect(account.allTimeAmountSent.toNumber()).to.equal(200 * ONE_USDC);
    });

    it("accumulates all_time_amount_sent across multiple calls", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const r1 = makeRecipients(1, ctx.mint, 100 * ONE_USDC)[0];
        const r2 = makeRecipients(1, ctx.mint, 400 * ONE_USDC)[0];

        await callBulkTransfer(program, ctx, [r1.input], [r1.keypair.publicKey], [r1.ata]);
        await callBulkTransfer(program, ctx, [r2.input], [r2.keypair.publicKey], [r2.ata]);

        const [userAccountPda] = deriveUserAccount(ctx.sender.publicKey, program.programId);
        const account = await fetchUserAccount(program, userAccountPda);
        expect(account.allTimeAmountSent.toNumber()).to.equal(500 * ONE_USDC);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 5 — Scale and limits
// ═══════════════════════════════════════════════════════════════════════════════

describe("bulk_transfer › scale and limits", () => {
    const program = getProgram();
    const connection = getProvider().connection;

    it("handles a single recipient receiving across multiple batches", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        const ata = deriveAta(recipient.publicKey, ctx.mint);

        for (let i = 0; i < 3; i++) {
            await callBulkTransfer(
                program, ctx,
                [{ amountToBeReceived: new anchor.BN(10 * ONE_USDC) }],
                [recipient.publicKey],
                [ata]
            );
        }

        expect(await getTokenBalance(connection, ata)).to.equal(30_000_000n);

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(3);
        expect(records[2].totalAllTimeReceived.toNumber()).to.equal(30 * ONE_USDC);
    });

    it("works at the maximum account limit (14 recipients) using v0 + ALT", async () => {
        const ctx = await bootstrapSuite(program, connection, 2);
        const recipients = makeRecipients(14, ctx.mint, ONE_USDC);

        // Pre-ATA pass — mandatory for high recipient counts.
        // create_idempotent with existing ATAs costs ~1 trace entry vs ~4 for new ones.
        // 14 new ATAs would push trace entries to ~70, exceeding the 64 hard limit.
        for (const r of recipients) {
            await createAtaWithBalance(
                connection, ctx.sender, ctx.mint, r.keypair.publicKey, 0n
            );
        }

        const dataSize = estimateInstructionDataSize(recipients.length);
        expect(dataSize).to.be.lessThan(200, `Instruction data unexpectedly large: ${dataSize} bytes`);

        await callBulkTransferV0(
            program, connection, ctx,
            recipients.map((r) => r.input),
            recipients.map((r) => r.keypair.publicKey),
            recipients.map((r) => r.ata)
        );

        for (const r of recipients) {
            expect(await getTokenBalance(connection, r.ata)).to.equal(BigInt(ONE_USDC));
        }

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const log = await fetchTransferLog(program, logPda);
        expect(log.records.length).to.be.gte(14);
    });
});