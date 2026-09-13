"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Portal overlay so Sage Agree forms sit above chat/drawer stacking contexts. */
export function SageAgreeFormModal({
  title,
  titleId,
  hint,
  onClose,
  children,
}: {
  title: string;
  titleId: string;
  hint: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 px-3 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="relative my-4 w-full max-w-md rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2
            id={titleId}
            className="font-heading text-base font-semibold text-[#3D3D3D]"
          >
            {title}
          </h2>
          <button
            type="button"
            className="rounded-md p-1.5 text-[#8A8A8A] hover:bg-[#E8E4DC] hover:text-[#3D3D3D]"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-3 text-[11px] text-[#8A8A8A]">{hint}</p>
        {children}
      </div>
    </div>,
    document.body
  );
}
