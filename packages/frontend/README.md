# BulkPay Frontend

Solana bulk transfer protocol — send USDC to multiple wallets in one transaction.

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — click "Connect wallet" to enter the app.

## Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS** with custom BulkPay design tokens
- **Fonts**: Playfair Display (headings), DM Sans (body), DM Mono (addresses/amounts)

## Color scheme

| Token | Hex | Usage |
|-------|-----|-------|
| `bp-bg` | `#FAFAF9` | Page background |
| `bp-dark` | `#0F1117` | Navbar, stat cards |
| `bp-accent` | `#C8FF00` | Primary action, active nav |
| `bp-dark-btn` | `#1F2937` | Secondary buttons |
| `bp-danger` | `#7F1D1D` | Cancel/destructive |

## Pages

| Page | File | Description |
|------|------|-------------|
| Login | `LoginScreen.tsx` | Shown when wallet disconnected |
| Dashboard | `pages/Dashboard.tsx` | Greeting, stats, recent batches |
| Send | `pages/Send.tsx` | Batch title, recipient builder, schedule mode |
| History | `pages/History.tsx` | All batches with tx signatures |
| Batch detail | `pages/BatchDetail.tsx` | Expandable recipient list |
| Schedules | `pages/Schedules.tsx` | Active/cancelled with cancel button |
| Faucet | `pages/Faucet.tsx` | Mint test USDC to connected wallet |
| Profile | `pages/Profile.tsx` | Edit name, view all-time stats |

## Customization notes

- **Wallet integration**: Replace `WalletContext.tsx` mock with `@solana/wallet-adapter-react`. The `connect()` and `disconnect()` functions map directly to the adapter's API.
- **API integration**: Replace `mockData.ts` with real API calls to your Rust backend.
- **Routing**: Currently uses client-side page state. To add URL routing, convert pages to Next.js App Router routes and move the wallet gate to middleware.
- **Mobile**: All pages are responsive — Tailwind `sm:` breakpoint at 640px handles the mobile/desktop split.
