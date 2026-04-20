import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
    Keypair,
    Connection,
    PublicKey,
    LAMPORTS_PER_SOL,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import { BulkPay } from "../../target/types/bulk_pay";

export function getProvider(): anchor.AnchorProvider {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    return provider;
}

export function getProgram(): Program<BulkPay> {
    const provider = getProvider();
    return anchor.workspace.BulkPay as Program<BulkPay>;
}

export function deriveUserAccount(owner: PublicKey, programId: PublicKey) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("useraccount"), owner.toBuffer()],
        programId
    );
}

export function deriveTransferLog(sender: PublicKey, programId: PublicKey) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("transferlog"), sender.toBuffer()],
        programId
    );
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Transfers SOL from the provider wallet to a target pubkey.
 * Use this instead of airdrop to avoid devnet rate limiting.
 * Make sure your ANCHOR_WALLET has enough SOL before running tests.
 */
export async function fundFromWallet(
    connection: Connection,
    destination: PublicKey,
    sol: number = 0.2
): Promise<void> {
    const provider = getProvider();

    const tx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: provider.wallet.publicKey,
            toPubkey: destination,
            lamports: sol * LAMPORTS_PER_SOL,
        })
    );

    const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = provider.wallet.publicKey;

    // provider.wallet.signTransaction uses your ANCHOR_WALLET keypair
    const signed = await provider.wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());

    await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
    );
}

/**
 * Creates a fresh keypair and funds it from the provider wallet.
 * Drop sol amount to 0.1–0.5 since devnet tests don't need much.
 */
export async function createFundedWallet(
    connection: Connection,
    sol: number = 0.1  // keep low — transfers from your own wallet
): Promise<Keypair> {
    const kp = Keypair.generate();
    await fundFromWallet(connection, kp.publicKey, sol);
    return kp;
}

export async function getSolBalance(
    connection: Connection,
    pubkey: PublicKey
): Promise<number> {
    return connection.getBalance(pubkey, "confirmed");
}