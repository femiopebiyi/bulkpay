import * as anchor from "@coral-xyz/anchor";
import {
    Keypair,
    PublicKey,
    Connection,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    getAccount,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

export type TokenProgramVariant = "legacy" | "token2022";

/** Creates a mint and returns its public key */
export async function createTestMint(
    connection: Connection,
    payer: Keypair,
    decimals: number = 6,
    variant: TokenProgramVariant = "legacy"
): Promise<PublicKey> {
    const tokenProgram =
        variant === "token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    return createMint(
        connection,
        payer,
        payer.publicKey, // mint authority
        null,            // freeze authority
        decimals,
        undefined,
        { commitment: "confirmed" },
        tokenProgram
    );
}

/** Creates an ATA and optionally mints tokens into it */
export async function createAtaWithBalance(
    connection: Connection,
    payer: Keypair,
    mint: PublicKey,
    owner: PublicKey,
    amount: bigint,
    variant: TokenProgramVariant = "legacy"
): Promise<PublicKey> {
    const tokenProgram =
        variant === "token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        owner,
        false,
        "confirmed",
        { commitment: "confirmed" },
        tokenProgram
    );

    if (amount > 0n) {
        await mintTo(
            connection,
            payer,
            mint,
            ata.address,
            payer, // mint authority
            amount,
            [],
            { commitment: "confirmed" },
            tokenProgram
        );
    }

    return ata.address;
}

/** Returns the token balance of an ATA as a bigint */
export async function getTokenBalance(
    connection: Connection,
    ata: PublicKey,
    variant: TokenProgramVariant = "legacy"
): Promise<bigint> {
    const tokenProgram =
        variant === "token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const info = await getAccount(connection, ata, "confirmed", tokenProgram);
    return info.amount;
}

/** Derives an ATA address without creating it */
export function deriveAta(
    owner: PublicKey,
    mint: PublicKey,
    variant: TokenProgramVariant = "legacy"
): PublicKey {
    const tokenProgram =
        variant === "token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    return getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
}

export async function confirmTx(
    connection: Connection,
    sig: string
): Promise<void> {
    const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
    await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
    );
}

export { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };