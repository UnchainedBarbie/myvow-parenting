"use client";

export function PrintRecordButton() {
  return (
    <button
      type="button"
      className="no-print"
      onClick={() => window.print()}
    >
      Print
    </button>
  );
}
