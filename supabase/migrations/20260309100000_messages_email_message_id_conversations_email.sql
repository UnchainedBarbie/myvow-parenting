-- Store Postmark Message-ID for messages sent via email (for threading and audit)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS email_message_id text;

-- Conversation email forwarding: co-parent email and thread id for threading
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS coparent_email text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS email_thread_id text;
