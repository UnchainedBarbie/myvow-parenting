"use client";

import { Button } from "@/components/ui/button";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmTone = "default",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  const confirmClasses =
    confirmTone === "danger"
      ? "h-8 rounded-full bg-[#D0705A] text-xs text-white hover:bg-[#B85E4A]"
      : "h-8 rounded-full text-xs";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[380px] rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card">
        <h2 className="font-heading text-base font-semibold text-[#3D3D3D]">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[11px] text-[#8A8A8A]">{description}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full text-xs"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            className={confirmClasses}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

