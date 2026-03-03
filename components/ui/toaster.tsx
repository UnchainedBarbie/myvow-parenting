"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
  durationMs: number;
};

type Listener = (toast: Toast) => void;

let listeners: Listener[] = [];
let idCounter = 1;

function emitToast(toast: Omit<Toast, "id">) {
  const full: Toast = { ...toast, id: idCounter++ };
  listeners.forEach((l) => l(full));
}

export function showToast(options: {
  message: string;
  type?: ToastType;
  durationMs?: number;
}) {
  emitToast({
    message: options.message,
    type: options.type ?? "success",
    durationMs: options.durationMs ?? 3000,
  });
}

export function showSuccessToast(message: string, durationMs = 3000) {
  showToast({ message, type: "success", durationMs });
}

export function showErrorToast(message: string, durationMs = 3000) {
  showToast({ message, type: "error", durationMs });
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const listener: Listener = (toast) => {
      setToasts((prev) => [...prev, toast]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, toast.durationMs);
    };
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-3">
      <div className="flex flex-col gap-2 max-w-md w-full items-center">
        {toasts.map((toast) => {
          const isError = toast.type === "error";
          return (
            <div
              key={toast.id}
              className={cn(
                "pointer-events-auto flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-sm transition-opacity duration-200",
                isError
                  ? "border-[#E2C877] bg-[#FDF6E3] text-[#B8960F]"
                  : "border-[#C5CFBC] bg-[#F2F5EF] text-[#5B7A52]"
              )}
            >
              {isError ? (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              )}
              <p className="text-[13px] leading-snug">{toast.message}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

