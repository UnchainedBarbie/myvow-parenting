-- Contacts and contact_children tables

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) NOT NULL,
  created_by UUID REFERENCES users(id) NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  organization TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  visibility TEXT DEFAULT 'parents' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contacts_case_id ON contacts(case_id);

CREATE TABLE IF NOT EXISTS contact_children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id) NOT NULL,
  child_id UUID REFERENCES children(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_children_contact_id ON contact_children(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_children_child_id ON contact_children(child_id);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_children ENABLE ROW LEVEL SECURITY;

-- Contacts visible and editable to case members only
CREATE POLICY contacts_case_members ON contacts
  FOR ALL
  USING (
    case_id IN (
      SELECT case_id FROM case_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    case_id IN (
      SELECT case_id FROM case_members WHERE user_id = auth.uid()
    )
  );

-- Junction rows only for contacts in the user's cases
CREATE POLICY contact_children_case_members ON contact_children
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM contacts c
      JOIN case_members m ON m.case_id = c.case_id
      WHERE c.id = contact_id
        AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM contacts c
      JOIN case_members m ON m.case_id = c.case_id
      WHERE c.id = contact_id
        AND m.user_id = auth.uid()
    )
  );

