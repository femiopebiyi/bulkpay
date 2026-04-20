// lib/solana.ts
//
// Production-ready Solana utilities for BulkPay.
// Currently uses mock implementations — swap with real @solana/web3.js
// calls when integrating the wallet adapter.
//
// Real integration requires:
//   npm install @solana/web3.js @solana/spl-token @coral-xyz/anchor

// ─── Blockhash cache ──────────────────────────────────────────────────────────
//
// Avoids a 200ms RPC call on every transaction build.
// Blockhash is valid for ~60s on mainnet, we refresh every 30s.

class BlockhashCache {
  private blockhash = "";
  private lastValidBlockHeight = 0;
  private fetchedAt = 0;
  private readonly TTL = 30_000;

  async get(connection: any): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    if (Date.now() - this.fetchedAt > this.TTL) {
      // Real: const result = await connection.getLatestBlockhash('confirmed');
      this.blockhash = `mock_${Date.now().toString(36)}`;
      this.lastValidBlockHeight = 999999;
      this.fetchedAt = Date.now();
    }
    return { blockhash: this.blockhash, lastValidBlockHeight: this.lastValidBlockHeight };
  }

  startWarmup(connection: any) {
    this.get(connection);
    setInterval(() => this.get(connection), 30_000);
  }
}

export const blockhashCache = new BlockhashCache();

// ─── ATA checks ───────────────────────────────────────────────────────────────
//
// Check if a recipient's ATA exists before sending.
// In production: getAccount(connection, ata, 'confirmed', tokenProgram)

export async function checkAtaExists(address: string, _mint?: string): Promise<boolean> {
  // Mock: simulate 200ms RPC call, 85% of addresses have ATAs
  await sleep(200);
  const hash = simpleHash(address);
  return hash % 100 < 85;
}

export async function checkMultipleAtas(
  addresses: string[],
  mint: string
): Promise<Map<string, boolean>> {
  // Real: use getMultipleAccountsInfo for a single RPC call
  // instead of N individual calls — 10x faster
  const results = new Map<string, boolean>();
  const BATCH = 100; // getMultipleAccountsInfo limit

  for (let i = 0; i < addresses.length; i += BATCH) {
    const chunk = addresses.slice(i, i + BATCH);
    // Real: const infos = await connection.getMultipleAccountsInfo(ataAddresses);
    await sleep(300); // simulate single RPC call for whole chunk
    for (const addr of chunk) {
      results.set(addr, simpleHash(addr) % 100 < 85);
    }
  }
  return results;
}

export async function createMissingAtas(
  addresses: string[],
  _mint: string,
  onProgress?: (created: number, total: number) => void
): Promise<void> {
  const PARALLEL = addresses.length <= 10 ? addresses.length : 8;

  for (let i = 0; i < addresses.length; i += PARALLEL) {
    const chunk = addresses.slice(i, i + PARALLEL);
    await Promise.all(chunk.map(async (_, idx) => {
      await sleep(400 + Math.random() * 300);
      onProgress?.(Math.min(i + idx + 1, addresses.length), addresses.length);
    }));
  }
}

// ─── Transaction retry with exponential backoff ───────────────────────────────

export async function sendWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 500
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw new Error("Max retries exceeded");
}

// ─── Validate Solana address ──────────────────────────────────────────────────

export function isValidSolanaAddress(address: string): boolean {
  // Base58 check: 32-44 chars, only valid base58 characters
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
