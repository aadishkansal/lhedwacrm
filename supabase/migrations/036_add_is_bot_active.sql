-- ============================================================
-- 036_add_is_bot_active.sql
-- Table: conversations
-- Adds is_bot_active column to control AI auto-reply
-- ============================================================

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS is_bot_active BOOLEAN NOT NULL DEFAULT TRUE;
