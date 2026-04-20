"use client";
import { useToast } from "@/context/ToastContext";

const iconMap = {
  success: "\u2713",
  error: "\u2717",
  info: "\u2139",
};

const bgMap = {
  success: "bg-emerald-900 text-emerald-100",
  error: "bg-red-900 text-red-100",
  info: "bg-bp-dark text-gray-100",
};

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();
  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${bgMap[t.type]} px-4 py-3 rounded-lg text-sm font-body flex items-start gap-2 animate-slide-up shadow-lg`}
        >
          <span className="font-mono text-xs mt-0.5">{iconMap[t.type]}</span>
          <span className="flex-1">{t.message}</span>
          <button onClick={() => removeToast(t.id)} className="text-white/40 hover:text-white/80 ml-2 cursor-pointer">x</button>
        </div>
      ))}
    </div>
  );
}
