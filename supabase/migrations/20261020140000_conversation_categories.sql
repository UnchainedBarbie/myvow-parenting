-- Conversation categories for the Communication Record.
-- A conversation may have more than one category. Categories are organizational
-- labels, not findings about either parent. This does not classify existing
-- conversations and does not change message content.
--
-- Run this manually in the Supabase SQL editor. The application does not apply it.

CREATE TABLE IF NOT EXISTS conversation_categories (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, category),
  CONSTRAINT conversation_categories_category_check CHECK (
    category IN (
      'health_medical',
      'education',
      'parenting_schedule',
      'finances',
      'activities',
      'child_wellbeing',
      'parenting_decisions',
      'legal_court',
      'general'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_conversation_categories_case_category
  ON conversation_categories (case_id, category);

CREATE OR REPLACE FUNCTION public.conversation_categories_match_case()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM conversations
    WHERE id = NEW.conversation_id
      AND case_id = NEW.case_id
  ) THEN
    RAISE EXCEPTION 'conversation_categories.case_id must match the conversation case';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversation_categories_match_case ON conversation_categories;
CREATE TRIGGER conversation_categories_match_case
  BEFORE INSERT OR UPDATE ON conversation_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.conversation_categories_match_case();

ALTER TABLE conversation_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_categories_select ON conversation_categories;
CREATE POLICY conversation_categories_select ON conversation_categories
  FOR SELECT
  USING (
    case_id IN (
      SELECT case_id FROM case_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS conversation_categories_insert ON conversation_categories;
CREATE POLICY conversation_categories_insert ON conversation_categories
  FOR INSERT
  WITH CHECK (
    case_id IN (
      SELECT case_id FROM case_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS conversation_categories_delete ON conversation_categories;
CREATE POLICY conversation_categories_delete ON conversation_categories
  FOR DELETE
  USING (
    case_id IN (
      SELECT case_id FROM case_members WHERE user_id = auth.uid()
    )
  );
