"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CreateCaseButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setLoading(true);
    try {
      const res = await fetch("/api/cases/create", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create case");
      router.push("/messages");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleCreate} disabled={loading}>
      {loading ? "Creating…" : "Create new case"}
    </Button>
  );
}
