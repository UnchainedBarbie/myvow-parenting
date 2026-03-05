-- Add invited contact fields for children (email/phone used for invites).

ALTER TABLE children
ADD COLUMN IF NOT EXISTS invited_email TEXT;

ALTER TABLE children
ADD COLUMN IF NOT EXISTS invited_phone TEXT;

