-- ============================================================
-- 015_scalable_crm_redesign.sql
-- redescending database architecture for multi-tenant scalability
-- and AI agent tracing.
-- ============================================================

-- 1. Helper Security Function
CREATE OR REPLACE FUNCTION public.get_user_organizations()
RETURNS TABLE (org_id UUID) 
LANGUAGE sql 
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT organization_id 
  FROM organization_users 
  WHERE user_id = auth.uid();
$$;

-- 2. Alter existing core tables for Multi-Tenancy & Soft Deletes
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE epc_projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 3. Create AI Memory & Tracing Tables
CREATE TABLE IF NOT EXISTS contact_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL DEFAULT 'fact' CHECK (memory_type IN ('fact', 'preference', 'interaction')),
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_id UUID NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB DEFAULT '{}'::jsonb,
  duration_ms INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Create Project Milestone & Installation Update Tables
CREATE TABLE IF NOT EXISTS project_milestones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES epc_projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  target_date DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS installation_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES epc_projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  update_type TEXT NOT NULL CHECK (update_type IN ('structural', 'electrical', 'panels', 'metering')),
  description TEXT NOT NULL,
  photo_urls TEXT[] DEFAULT '{}'::text[],
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Create Billing (Invoices, Payments & Reminders)
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID REFERENCES epc_quotes(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS invoice_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'email')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  reminder_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Create Support Ticket Comments
CREATE TABLE IF NOT EXISTS ticket_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Audit Logging System
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.process_audit_logging()
RETURNS TRIGGER AS $$
DECLARE
  org_id UUID;
  u_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    org_id := OLD.organization_id;
  ELSE
    org_id := NEW.organization_id;
  END IF;
  
  u_id := auth.uid();

  INSERT INTO audit_logs (organization_id, user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    org_id,
    u_id,
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Attach Audit Triggers
DROP TRIGGER IF EXISTS audit_contacts ON contacts;
CREATE TRIGGER audit_contacts AFTER INSERT OR UPDATE OR DELETE ON contacts FOR EACH ROW EXECUTE FUNCTION process_audit_logging();

DROP TRIGGER IF EXISTS audit_deals ON deals;
CREATE TRIGGER audit_deals AFTER INSERT OR UPDATE OR DELETE ON deals FOR EACH ROW EXECUTE FUNCTION process_audit_logging();

DROP TRIGGER IF EXISTS audit_epc_projects ON epc_projects;
CREATE TRIGGER audit_epc_projects AFTER INSERT OR UPDATE OR DELETE ON epc_projects FOR EACH ROW EXECUTE FUNCTION process_audit_logging();

DROP TRIGGER IF EXISTS audit_support_tickets ON support_tickets;
CREATE TRIGGER audit_support_tickets AFTER INSERT OR UPDATE OR DELETE ON support_tickets FOR EACH ROW EXECUTE FUNCTION process_audit_logging();

-- 8. Indexes Strategy
CREATE INDEX IF NOT EXISTS idx_contact_mem_embedding ON contact_memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_org_deleted ON contacts (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_org_status ON deals (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals (contact_id);
CREATE INDEX IF NOT EXISTS idx_tickets_contact ON support_tickets (contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices (organization_id, due_date) WHERE (deleted_at IS NULL AND status != 'paid');

-- 9. Row Level Security Policies
ALTER TABLE contact_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Dynamic Policies Helpers
DROP POLICY IF EXISTS "Users view own memories" ON contact_memories;
CREATE POLICY "Users view memories in their organizations" ON contact_memories FOR ALL
  USING (organization_id IN (SELECT get_user_organizations()));

DROP POLICY IF EXISTS "Users view executions" ON agent_executions;
CREATE POLICY "Users view executions in their organizations" ON agent_executions FOR ALL
  USING (organization_id IN (SELECT get_user_organizations()));

DROP POLICY IF EXISTS "Users view tool calls" ON agent_tool_calls;
CREATE POLICY "Users view tool calls in their executions" ON agent_tool_calls FOR ALL
  USING (EXISTS (
    SELECT 1 FROM agent_executions e
    WHERE e.id = agent_tool_calls.execution_id
      AND e.organization_id IN (SELECT get_user_organizations())
  ));

DROP POLICY IF EXISTS "Users view milestones" ON project_milestones;
CREATE POLICY "Users view milestones in their organizations" ON project_milestones FOR ALL
  USING (organization_id IN (SELECT get_user_organizations()));

DROP POLICY IF EXISTS "Users view installations" ON installation_updates;
CREATE POLICY "Users view installations in their organizations" ON installation_updates FOR ALL
  USING (organization_id IN (SELECT get_user_organizations()));

DROP POLICY IF EXISTS "Users view invoices" ON invoices;
CREATE POLICY "Users view invoices in their organizations" ON invoices FOR ALL
  USING (organization_id IN (SELECT get_user_organizations()));

DROP POLICY IF EXISTS "Users view reminders" ON invoice_reminders;
CREATE POLICY "Users view reminders in their organizations" ON invoice_reminders FOR ALL
  USING (organization_id IN (SELECT get_user_organizations()));

DROP POLICY IF EXISTS "Users view comments" ON ticket_comments;
CREATE POLICY "Users view comments in their organizations" ON ticket_comments FOR ALL
  USING (organization_id IN (SELECT get_user_organizations()));

DROP POLICY IF EXISTS "Users view audit logs" ON audit_logs;
CREATE POLICY "Users view audit logs in their organizations" ON audit_logs FOR ALL
  USING (organization_id IN (SELECT get_user_organizations()));
