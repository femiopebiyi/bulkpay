# BulkPay Frontend v2

Solana bulk transfer protocol — production-ready frontend with batch execution engine.

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — click "Connect wallet" to enter.

## What's new in v2

### Batch execution engine (`lib/batch.ts`)
- **Auto-splitting**: recipients over 30 are split into sub-batches automatically
- **Parallel submission**: all sub-batches are submitted and confirmed simultaneously
- **Pre-flight validation**: balance checks, duplicate detection, ATA status, sub-batch warnings
- **Progress UI**: real-time overlay showing ATA creation → signing → per-batch confirmation

### ATA pre-checking (`lib/solana.ts`)
- **On-input checking**: as soon as a wallet address is entered, the ATA status is checked (debounced 600ms)
- **Visual indicators**: green dot = ready, amber = needs creating, blue pulse = checking
- **Bulk checking**: `checkMultipleAtas()` uses `getMultipleAccountsInfo` for a single RPC call instead of N calls
- **Background creation**: missing ATAs are created in parallel before the batch is sent

### Optimistic UI
- **Instant feedback**: transaction shows "submitted" immediately, confirms in background
- **Toast notifications**: success/error/info toasts appear at bottom-right
- **No blocking spinners**: user can navigate away during confirmation

### Blockhash caching (`lib/solana.ts`)
- Pre-fetched every 30 seconds in the background
- Eliminates 200ms latency on every transaction build
- Auto-refreshes before expiry

### Retry with exponential backoff
- Failed transactions retry up to 3 times (500ms → 1s → 2s)
- Fresh blockhash on each retry attempt

## Production integration checklist

Replace mock implementations with real ones:

| File | What to swap |
|------|-------------|
| `context/WalletContext.tsx` | Replace with `@solana/wallet-adapter-react` |
| `lib/solana.ts` | Replace mock functions with real `@solana/web3.js` calls |
| `lib/batch.ts` | Replace mock execution with real `wallet.signAllTransactions()` + `connection.sendRawTransaction()` |
| `lib/mockData.ts` | Replace with API calls to your Rust backend |

### Key integration points

**Wallet adapter:**
```tsx
// Replace WalletProvider with:
import { WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
```

**Batch execution (real):**
```ts
// In lib/batch.ts, replace the mock execution with:
const signedTxs = await wallet.signAllTransactions(transactions);
const sigs = await Promise.all(
  signedTxs.map(tx => connection.sendRawTransaction(tx.serialize()))
);
await Promise.all(
  sigs.map(sig => connection.confirmTransaction(sig, 'confirmed'))
);
```

**ATA checking (real):**
```ts
// In lib/solana.ts, replace checkAtaExists with:
import { getAccount } from '@solana/spl-token';
const info = await getAccount(connection, ataAddress, 'confirmed');
return info !== null;
```

## Architecture

```
src/
├── app/
│   ├── globals.css
│   ├── layout.tsx          # Root layout with WalletProvider + ToastProvider
│   └── page.tsx            # App shell — page routing + toast container
├── components/
│   ├── LoginScreen.tsx     # Connect wallet gate
│   ├── Navbar.tsx          # Dark nav + wallet popup (profile/disconnect)
│   ├── Toast.tsx           # Toast notification renderer
│   └── pages/
│       ├── Dashboard.tsx   # Greeting, stats, clickable batch table
│       ├── Send.tsx        # Full send flow with batch progress overlay
│       ├── History.tsx     # Batch history with tx signatures
│       ├── BatchDetail.tsx # Expandable recipients (name/wallet/desc/amount)
│       ├── Schedules.tsx   # Active schedules with cancel buttons
│       ├── Faucet.tsx      # Mint to connected wallet
│       └── Profile.tsx     # Editable name, all-time stats
├── context/
│   ├── WalletContext.tsx   # Mock wallet — swap with adapter
│   └── ToastContext.tsx    # Toast notification state
└── lib/
    ├── types.ts            # All TypeScript interfaces
    ├── mockData.ts         # Sample data — swap with API calls
    ├── solana.ts           # Blockhash cache, ATA utils, retry, validation
    └── batch.ts            # Batch splitting, execution engine, preflight
```

## Design tokens

| Token | Hex | Usage |
|-------|-----|-------|
| `bp-bg` | `#FAFAF9` | Page background |
| `bp-dark` | `#0F1117` | Navbar, stat cards, primary buttons |
| `bp-accent` | `#C8FF00` | Primary action, active states |
| `bp-dark-btn` | `#1F2937` | Secondary buttons |
| `bp-danger` | `#7F1D1D` | Cancel/destructive |

**Fonts**: Playfair Display (headings), DM Sans (body), DM Mono (addresses/amounts)
