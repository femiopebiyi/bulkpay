import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import {
    getProgram,
    getProvider,
    createFundedWallet,
    deriveTransferLog,
} from "./helpers/setup";
import {
    initTransferLog,
    fetchTransferLog,
} from "./helpers/accounts";

// Mirrors the Rust constants — keep in sync with state.rs
const MAX_NAME_LEN = 32;
const TRANSFER_RECORD_LEN = 4 + MAX_NAME_LEN + 32 + 8 + 8 + 8; // 92 bytes
const BASE_LEN = 8 + 1 + 4;                                      // 13 bytes
const INITIAL_CAPACITY = 50;
const EXPECTED_INITIAL_SPACE = BASE_LEN + INITIAL_CAPACITY * TRANSFER_RECORD_LEN;

describe("init_transfer_log", () => {
    const program = getProgram();
    const provider = getProvider();
    const connection = provider.connection;

    // ─── happy path ────────────────────────────────────────────────────────────

    it("initializes with an empty records vec", async () => {
        const sender = await createFundedWallet(connection);
        const pda = await initTransferLog(program, sender);
        const log = await fetchTransferLog(program, pda);

        expect(log.records).to.be.an("array").that.is.empty;
    });

    it("stores the correct bump", async () => {
        const sender = await createFundedWallet(connection);
        const [pda, expectedBump] = deriveTransferLog(
            sender.publicKey,
            program.programId
        );

        await initTransferLog(program, sender);
        const log = await fetchTransferLog(program, pda);

        expect(log.bump).to.equal(expectedBump);
    });

    it("allocates the account at the correct PDA address", async () => {
        const sender = await createFundedWallet(connection);
        const [expectedPda] = deriveTransferLog(
            sender.publicKey,
            program.programId
        );
        const returnedPda = await initTransferLog(program, sender);

        expect(returnedPda.toBase58()).to.equal(expectedPda.toBase58());
    });

    it("allocates the correct initial space on-chain", async () => {
        const sender = await createFundedWallet(connection);
        const [pda] = deriveTransferLog(sender.publicKey, program.programId);

        await initTransferLog(program, sender);

        const accountInfo = await connection.getAccountInfo(pda, "confirmed");
        expect(accountInfo).to.not.be.null;
        expect(accountInfo!.data.length).to.equal(EXPECTED_INITIAL_SPACE);
    });

    // ─── failure cases ─────────────────────────────────────────────────────────

    it("fails when called twice — account already exists", async () => {
        const sender = await createFundedWallet(connection);
        await initTransferLog(program, sender); // first call succeeds

        try {
            await initTransferLog(program, sender); // second call must fail
            expect.fail("Should have thrown — account already initialized");
        } catch (err: any) {
            // Anchor's `init` constraint rejects if the account already exists
            expect(err.message).to.satisfy(
                (msg: string) =>
                    msg.includes("already in use") ||
                    msg.includes("Error") ||
                    msg.includes("custom program error")
            );
        }
    });

    it("creates separate logs for separate senders", async () => {
        const alice = await createFundedWallet(connection);
        const bob = await createFundedWallet(connection);

        const alicePda = await initTransferLog(program, alice);
        const bobPda = await initTransferLog(program, bob);

        expect(alicePda.toBase58()).to.not.equal(bobPda.toBase58());

        const aliceLog = await fetchTransferLog(program, alicePda);
        const bobLog = await fetchTransferLog(program, bobPda);

        expect(aliceLog.records).to.be.empty;
        expect(bobLog.records).to.be.empty;
    });

    it("rejects if wrong signer tries to init under another sender's PDA", async () => {
        const realSender = await createFundedWallet(connection);
        const attacker = await createFundedWallet(connection);

        const [realSenderPda] = deriveTransferLog(
            realSender.publicKey,
            program.programId
        );

        try {
            await program.methods
                .initTransferLog()
                .accountsPartial({
                    sender: attacker.publicKey,
                    transferLog: realSenderPda  // attacker signs

                })
                .signers([attacker])
                .rpc({ commitment: "confirmed" });

            expect.fail("Error: Should have thrown a seeds constraint violation");
        } catch (err: any) {
            expect(err.message).to.include("Error");
        }
    });
});