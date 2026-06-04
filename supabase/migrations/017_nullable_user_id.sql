-- ============================================================
-- 017_nullable_user_id.sql
-- Drop NOT NULL constraints on user_id for multi-tenant sharing
-- ============================================================

ALTER TABLE contacts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE deals ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE conversations ALTER COLUMN user_id DROP NOT NULL;
