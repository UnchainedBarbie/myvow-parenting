-- Personal parenting vows per user & case

CREATE TABLE IF NOT EXISTS vows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  content TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vows_case_id ON vows(case_id);
CREATE INDEX IF NOT EXISTS idx_vows_user_id ON vows(user_id);
CREATE INDEX IF NOT EXISTS idx_vows_pinned ON vows(case_id, user_id, is_pinned);

ALTER TABLE vows ENABLE ROW LEVEL SECURITY;

-- Vows are private to the author, within their case
CREATE POLICY vows_owner_case_members ON vows
  FOR ALL
  USING (
    user_id = auth.uid()
    AND case_id IN (
      SELECT case_id FROM case_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND case_id IN (
      SELECT case_id FROM case_members WHERE user_id = auth.uid()
    )
  );

