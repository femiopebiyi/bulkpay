import type { Metadata } from "next";
import { WalletProvider } from "@/context/WalletContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "BulkPay — Solana bulk transfers",
  description: "Send USDC to multiple wallets in one transaction",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bp-bg min-h-screen">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
