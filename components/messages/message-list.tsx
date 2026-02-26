"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble, type MessageRow } from "./message-bubble";

interface MessageListProps {
  messages: MessageRow[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <ScrollArea className="flex-1 px-4 py-4 h-[calc(100vh-12rem)]">
      <div className="space-y-4">
        {messages.length === 0 ? (
          <p className="text-center text-foreground-secondary py-8">
            No messages yet. Send a message to start the conversation.
          </p>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}
      </div>
    </ScrollArea>
  );
}
