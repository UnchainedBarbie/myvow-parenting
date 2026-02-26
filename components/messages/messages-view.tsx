"use client";

import { useRouter } from "next/navigation";
import { MessageList } from "./message-list";
import { ComposeBar } from "./compose-bar";
import type { MessageRow } from "./message-bubble";

interface MessagesViewProps {
  messages: MessageRow[];
  caseId: string;
}

export function MessagesView({ messages, caseId }: MessagesViewProps) {
  const router = useRouter();
  return (
    <>
      <MessageList messages={messages} />
      <ComposeBar caseId={caseId} onSent={() => router.refresh()} />
    </>
  );
}
