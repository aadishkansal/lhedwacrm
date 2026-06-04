-- ============================================================
-- 021_ai_telemetry_enhancements.sql
-- Add token cost and model/provider columns to agent_executions
-- ============================================================

ALTER TABLE public.agent_executions 
  ADD COLUMN IF NOT EXISTS prompt_cost NUMERIC(12, 6) DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS completion_cost NUMERIC(12, 6) DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12, 6) DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS model_used TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT;
