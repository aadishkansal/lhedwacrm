-- ============================================================
-- 025_agent_tool_framework.sql
-- Add logging and debugging columns to agent_tool_calls table
-- ============================================================

ALTER TABLE public.agent_tool_calls 
  ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('success', 'failure')) DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS error_message TEXT;
