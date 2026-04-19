"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { Page, BatchRecord } from "@/lib/types";
import LoginScreen from "@/components/LoginScreen";
import Navbar from "@/components/Navbar";
import Dashboard from "@/components/pages/Dashboard";
import Send from "@/components/pages/Send";
import History from "@/components/pages/History";
import Schedules from "@/components/pages/Schedules";
import Faucet from "@/components/pages/Faucet";
import Profile from "@/components/pages/Profile";
import BatchDetail from "@/components/pages/BatchDetail";

export default function Home() {
  const { connected } = useWallet();
  const [page, setPage] = useState<Page>("dashboard");
  const [prevPage, setPrevPage] = useState<Page>("dashboard");
  const [selectedBatch, setSelectedBatch] = useState<BatchRecord | null>(null);
  const [scheduleMode, setScheduleMode] = useState(false);

  if (!connected) return <LoginScreen />;

  const navigate = (p: Page) => {
    if (p !== "batch-detail") setPrevPage(page);
    setPage(p);
  };

  const openBatch = (batch: BatchRecord) => {
    setPrevPage(page);
    setSelectedBatch(batch);
    setPage("batch-detail");
  };

  const goToScheduleMode = () => {
    setScheduleMode(true);
    navigate("send");
  };

  const navPage = page === "batch-detail" || page === "profile" ? prevPage : page;

  return (
    <div className="min-h-screen bg-bp-bg">
      <Navbar activePage={navPage} onNavigate={navigate} />
      <main className="max-w-[1060px] mx-auto px-4 sm:px-6 py-5 sm:py-6">
        {page === "dashboard" && (
          <Dashboard onNavigate={navigate} onOpenBatch={openBatch} onNewSchedule={goToScheduleMode} />
        )}
        {page === "send" && (
          <Send initialScheduleMode={scheduleMode} onResetScheduleMode={() => setScheduleMode(false)} />
        )}
        {page === "history" && <History onOpenBatch={openBatch} />}
        {page === "schedules" && <Schedules onNewSchedule={goToScheduleMode} />}
        {page === "faucet" && <Faucet />}
        {page === "profile" && <Profile onBack={() => navigate(prevPage)} />}
        {page === "batch-detail" && selectedBatch && (
          <BatchDetail batch={selectedBatch} onBack={() => setPage(prevPage)} />
        )}
      </main>
    </div>
  );
}
