"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";

const AVATAR_LOGO = "/Horiztonal%20logo%20translucent.png";

export function HeaderAvatar() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [open]);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-8 w-8 flex items-center justify-center rounded-full overflow-hidden ring-1 ring-border/50 hover:ring-border hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-foreground/20"
        aria-label="Open menu"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Image
          src={AVATAR_LOGO}
          alt="MyVow"
          width={32}
          height={32}
          className="h-8 w-8 object-contain"
        />
      </button>
      {open && (
        <div
          className="absolute top-full right-0 mt-1 min-w-[10rem] rounded-lg border border-border bg-background shadow-lg py-1 z-50"
          role="menu"
        >
          <Link
            href="/profile"
            role="menuitem"
            className="block px-3 py-2 text-sm text-foreground hover:bg-muted/70 transition-colors"
            onClick={() => setOpen(false)}
          >
            Profile
          </Link>
          <Link
            href="/settings"
            role="menuitem"
            className="block px-3 py-2 text-sm text-foreground hover:bg-muted/70 transition-colors"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
        </div>
      )}
    </div>
  );
}
