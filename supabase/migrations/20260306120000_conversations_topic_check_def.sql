-- Function to return conversations_topic_check constraint definition (for debugging and validation).
-- Run in SQL Editor to inspect: SELECT get_conversations_topic_check_def();
CREATE OR REPLACE FUNCTION public.get_conversations_topic_check_def()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conname = 'conversations_topic_check'
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_conversations_topic_check_def() IS 'Returns the CHECK constraint definition for conversations.topic so app can align allowed values.';
