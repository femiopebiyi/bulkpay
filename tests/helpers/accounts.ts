import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BulkPay } from "../../target/types/bulk_pay";

export async function createUserAccount(
    program: Program<BulkPay>,
    owner: Keypair
): Promise<PublicKey> {
    const [accountPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("useraccount"), owner.publicKey.toBuffer()],
        program.programId
    );

    await program.methods
        .createAccount()
        .accountsPartial({
            owner: owner.publicKey,
            // ✅ Anchor auto-derives `account` PDA from seeds — don't pass it
            // ✅ Anchor auto-resolves `systemProgram` — don't pass it
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });

    return accountPda;
}

export async function initTransferLog(
    program: Program<BulkPay>,
    sender: Keypair
): Promise<PublicKey> {
    const [logPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("transferlog"), sender.publicKey.toBuffer()],
        program.programId
    );

    await program.methods
        .initTransferLog()
        .accountsPartial({
            sender: sender.publicKey,
            // ✅ Anchor auto-derives `transferLog` PDA from seeds — don't pass it
            // ✅ Anchor auto-resolves `systemProgram` — don't pass it
        })
        .signers([sender])
        .rpc({ commitment: "confirmed" });

    return logPda;
}

export async function fetchUserAccount(
    program: Program<BulkPay>,
    pda: PublicKey
) {
    return program.account.userAccount.fetch(pda, "confirmed");
}

export async function fetchTransferLog(
    program: Program<BulkPay>,
    pda: PublicKey
) {
    return program.account.transferLog.fetch(pda, "confirmed");
}