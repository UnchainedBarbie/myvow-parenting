-- Users: add profile_image URL for avatars
-- Safe to run multiple times.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_image TEXT;

COMMENT ON COLUMN users.profile_image IS 'Public URL for user avatar image stored in Supabase Storage (avatars bucket).';

