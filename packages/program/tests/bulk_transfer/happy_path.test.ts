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
    mintTo,
    // ✅ ASSOCIATED_TOKEN_PROGRAM_ID removed — no longer an account in BulkTransfer v2
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
const REFILL_FLOOR = 1_000_000_000n;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// v2: ATAs only — wallet addresses are read on-chain from ATA bytes 32..64
function buildRemainingAccounts(atas: PublicKey[]) {
    return atas.map((ata) => ({ pubkey: ata, isSigner: false, isWritable: true }));
}

async function bootstrapSuite(
    program: ReturnType<typeof getProgram>,
    connection: anchor.web3.Connection,
    solAmount = 0.1
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

// v2: atas only — no wallets param, no associatedTokenProgram
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
            // ✅ no associatedTokenProgram — removed from BulkTransfer accounts struct in v2
        })
        .remainingAccounts(buildRemainingAccounts(atas))
        .preInstructions([computeIx])
        .signers([ctx.sender])
        .rpc({ commitment: "confirmed" });
}

// Instruction data size: 4 (vec prefix) + count × 8 (u64 amount only)
function estimateInstructionDataSize(count: number): number {
    return 4 + count * 8;
}

// v2: atas only — no wallets param, ALT excludes wallets and associatedTokenProgram
async function callBulkTransferV0(
    program: ReturnType<typeof getProgram>,
    connection: anchor.web3.Connection,
    ctx: SuiteContext,
    recipients: RecipientInput[],
    atas: PublicKey[]  // ✅ ATAs only
): Promise<string> {
    const estimatedDataSize = estimateInstructionDataSize(recipients.length);
    if (estimatedDataSize > 900) {
        throw new Error(
            `Instruction data too large: ~${estimatedDataSize} bytes. Reduce batch size.`
        );
    }

    const [userAccountPda] = deriveUserAccount(ctx.sender.publicKey, program.programId);
    const [transferLogPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);

    // All non-signer named accounts + recipient ATAs go into the ALT.
    // sender excluded: signers must stay in static accounts section.
    // ✅ no wallets, no associatedTokenProgram
    const allAltAddresses = [
        userAccountPda,
        ctx.mint,
        ctx.senderAta,
        transferLogPda,
        TOKEN_PROGRAM_ID,
        anchor.web3.SystemProgram.programId,
        ...atas,
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
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(buildRemainingAccounts(atas))
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

// Generates keypairs + derives ATA addresses without creating them.
// Callers are responsible for pre-creating ATAs before passing to callBulkTransfer.
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
        const recipient = Keypair.generate();
        // ✅ ATA must be pre-created — v2 enforces this with AtaNotCreated
        const ata = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, recipient.publicKey, 0n
        );

        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(100 * ONE_USDC) }], [ata]);

        expect(await getTokenBalance(connection, ata)).to.equal(100_000_000n);
    });

    it("debits the exact amount from sender's ATA", async () => {
        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, recipient.publicKey, 0n
        );
        const before = await getTokenBalance(connection, ctx.senderAta);

        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(250 * ONE_USDC) }], [ata]);

        const after = await getTokenBalance(connection, ctx.senderAta);
        expect(before - after).to.equal(250_000_000n);
    });

    it("transfers correct individual amounts to multiple recipients", async () => {
        // Create 5 recipients with distinct amounts — pre-create ATAs first
        const recipients = await Promise.all(
            Array.from({ length: 5 }, async (_, i) => {
                const keypair = Keypair.generate();
                const ata = await createAtaWithBalance(
                    connection, ctx.sender, ctx.mint, keypair.publicKey, 0n
                );
                return { keypair, ata, input: { amountToBeReceived: new anchor.BN((i + 1) * ONE_USDC) } };
            })
        );

        await callBulkTransfer(
            program, ctx,
            recipients.map((r) => r.input),
            recipients.map((r) => r.ata)
        );

        for (const [i, r] of recipients.entries()) {
            expect(await getTokenBalance(connection, r.ata))
                .to.equal(BigInt((i + 1) * ONE_USDC));
        }
    });

    it("debits the exact total across multiple recipients", async () => {
        const amounts = [100, 200, 300]; // 600 USDC total
        const recipients = await Promise.all(
            amounts.map(async (amt) => {
                const keypair = Keypair.generate();
                const ata = await createAtaWithBalance(
                    connection, ctx.sender, ctx.mint, keypair.publicKey, 0n
                );
                return { keypair, ata, input: { amountToBeReceived: new anchor.BN(amt * ONE_USDC) } };
            })
        );

        const before = await getTokenBalance(connection, ctx.senderAta);

        await callBulkTransfer(
            program, ctx,
            recipients.map((r) => r.input),
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

    // ✅ "creates the recipient ATA when it does not exist" test REMOVED.
    // In v2, the program enforces AtaNotCreated if the ATA is missing.
    // This is now tested as a failure case in failures.test.ts.

    it("transfers succeed when ATA is pre-created", async () => {
        const recipient = Keypair.generate();
        const ata = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, recipient.publicKey, 0n
        );

        // ATA exists and is writable — transfer should succeed
        await callBulkTransfer(
            program, ctx,
            [{ amountToBeReceived: new anchor.BN(ONE_USDC) }],
            [ata]
        );

        expect(await getTokenBalance(connection, ata)).to.equal(BigInt(ONE_USDC));
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
            [ata]
        );

        const solAfter = await connection.getBalance(ctx.sender.publicKey, "confirmed");

        // Only tx fees (~5k lamports) — not ATA rent (~2,039,280 lamports)
        expect(solBefore - solAfter).to.be.lessThan(100_000);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 3 — Transfer log integrity
// ═══════════════════════════════════════════════════════════════════════════════

describe("bulk_transfer › transfer log integrity", () => {
    const program = getProgram();
    const connection = getProvider().connection;

    it("appends exactly recipients.length records per call", async () => {
        const ctx = await bootstrapSuite(program, connection);
        // ✅ pre-create ATAs — v2 requires them to exist
        const atas = await Promise.all(
            Array.from({ length: 3 }, async () => {
                const kp = Keypair.generate();
                return createAtaWithBalance(connection, ctx.sender, ctx.mint, kp.publicKey, 0n);
            })
        );

        await callBulkTransfer(
            program, ctx,
            atas.map(() => ({ amountToBeReceived: new anchor.BN(ONE_USDC) })),
            atas
        );

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);
        expect(records).to.have.length(3);
    });

    it("stores correct fields in each record", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        // ✅ pre-create ATA
        const ata = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, recipient.publicKey, 0n
        );
        const txTime = Math.floor(Date.now() / 1000);

        await callBulkTransfer(
            program, ctx,
            [{ amountToBeReceived: new anchor.BN(42 * ONE_USDC) }],
            [ata]
        );

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const record = (await fetchTransferLog(program, logPda)).records[0];

        // address comes from read_ata_owner — never passed by caller
        expect(record.address.toBase58()).to.equal(recipient.publicKey.toBase58());
        expect(record.amountReceived.toNumber()).to.equal(42 * ONE_USDC);
        expect(record.totalAllTimeReceived.toNumber()).to.equal(42 * ONE_USDC);
        expect(Math.abs(record.timestamp.toNumber() - txTime)).to.be.lessThan(30);
    });

    it("accumulates total_all_time_received across calls for the same recipient", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        // ✅ pre-create ATA — reused across both calls
        const ata = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, recipient.publicKey, 0n
        );
        const amount = new anchor.BN(50 * ONE_USDC);

        await callBulkTransfer(program, ctx, [{ amountToBeReceived: amount }], [ata]);
        await callBulkTransfer(program, ctx, [{ amountToBeReceived: amount }], [ata]);

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
        // ✅ pre-create both ATAs
        const ata1 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r1.publicKey, 0n);
        const ata2 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, r2.publicKey, 0n);

        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(ONE_USDC) }], [ata1]);
        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(ONE_USDC) }], [ata2]);

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(2);
        expect(records[0].address.toBase58()).to.equal(r1.publicKey.toBase58());
        expect(records[1].address.toBase58()).to.equal(r2.publicKey.toBase58());
    });

    it("correctly handles same recipient appearing twice in one batch", async () => {
        const ctx = await bootstrapSuite(program, connection);
        const recipient = Keypair.generate();
        // ✅ pre-create ATA — passed twice in same batch
        const ata = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, recipient.publicKey, 0n
        );
        const amount = new anchor.BN(10 * ONE_USDC);

        await callBulkTransfer(
            program, ctx,
            [{ amountToBeReceived: amount }, { amountToBeReceived: amount }],
            [ata, ata]
        );

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const { records } = await fetchTransferLog(program, logPda);

        expect(records).to.have.length(2);
        expect(records[0].totalAllTimeReceived.toNumber()).to.equal(10 * ONE_USDC);
        // second entry chains off the first — verifies same-batch accumulation fix
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
        // ✅ pre-create ATAs
        const atas = await Promise.all(
            Array.from({ length: 2 }, async () => {
                const kp = Keypair.generate();
                return createAtaWithBalance(connection, ctx.sender, ctx.mint, kp.publicKey, 0n);
            })
        );

        await callBulkTransfer(
            program, ctx,
            atas.map(() => ({ amountToBeReceived: new anchor.BN(100 * ONE_USDC) })),
            atas
        );

        const [userAccountPda] = deriveUserAccount(ctx.sender.publicKey, program.programId);
        const account = await fetchUserAccount(program, userAccountPda);
        expect(account.allTimeAmountSent.toNumber()).to.equal(200 * ONE_USDC);
    });

    it("accumulates all_time_amount_sent across multiple calls", async () => {
        const ctx = await bootstrapSuite(program, connection);
        // ✅ pre-create ATAs
        const kp1 = Keypair.generate();
        const kp2 = Keypair.generate();
        const ata1 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, kp1.publicKey, 0n);
        const ata2 = await createAtaWithBalance(connection, ctx.sender, ctx.mint, kp2.publicKey, 0n);

        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(100 * ONE_USDC) }], [ata1]);
        await callBulkTransfer(program, ctx, [{ amountToBeReceived: new anchor.BN(400 * ONE_USDC) }], [ata2]);

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
        // ✅ pre-create ATA — reused across 3 batches
        const ata = await createAtaWithBalance(
            connection, ctx.sender, ctx.mint, recipient.publicKey, 0n
        );

        for (let i = 0; i < 3; i++) {
            await callBulkTransfer(
                program, ctx,
                [{ amountToBeReceived: new anchor.BN(10 * ONE_USDC) }],
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
        // makeRecipients only derives ATA addresses — must pre-create separately
        const recipients = makeRecipients(50, ctx.mint, ONE_USDC);

        // ✅ Mandatory pre-ATA pass — program enforces AtaNotCreated otherwise.
        // Also keeps CPI trace entries low (~1 per transfer vs ~4 per new ATA creation).
        for (const r of recipients) {
            await createAtaWithBalance(
                connection, ctx.sender, ctx.mint, r.keypair.publicKey, 0n
            );
        }

        const dataSize = estimateInstructionDataSize(recipients.length);
        expect(dataSize).to.be.lessThan(2000, `Instruction data unexpectedly large: ${dataSize} bytes`);

        // ✅ only ATAs in remaining_accounts — no wallets
        await callBulkTransferV0(
            program, connection, ctx,
            recipients.map((r) => r.input),
            recipients.map((r) => r.ata)
        );

        for (const r of recipients) {
            expect(await getTokenBalance(connection, r.ata)).to.equal(BigInt(ONE_USDC));
        }

        const [logPda] = deriveTransferLog(ctx.sender.publicKey, program.programId);
        const log = await fetchTransferLog(program, logPda);
        expect(log.records.length).to.be.gte(50);
    });
});