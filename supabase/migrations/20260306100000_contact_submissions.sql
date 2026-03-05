-- Contact form submissions (sales + support)
CREATE TABLE IF NOT EXISTS contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('sales', 'support')),
  name TEXT,
  email TEXT NOT NULL,
  company_organization TEXT,
  role_title TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  account_number TEXT,
  screenshot_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Support screenshot uploads: use bucket 'support-screenshots' (public URLs for email)
INSERT INTO storage.buckets (id, name, public)
VALUES ('support-screenshots', 'support-screenshots', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to support-screenshots (path: user_id/filename)
CREATE POLICY IF NOT EXISTS "Authenticated users can upload support screenshots"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'support-screenshots');

CREATE POLICY IF NOT EXISTS "Public read for support screenshots"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'support-screenshots');
