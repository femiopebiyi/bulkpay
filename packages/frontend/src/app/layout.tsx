import type { Metadata, Viewport } from "next";
import Providers from "@/components/Provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "BulkPay, Solana bulk transfers",
  description: "Send USDC to multiple wallets in one transaction",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bp-bg min-h-screen">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}