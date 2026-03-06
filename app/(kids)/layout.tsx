import type { ReactNode } from "react";

export default function KidsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center px-4">
      {children}
    </div>
  );
}

