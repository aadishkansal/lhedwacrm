-- ============================================================
-- 029_shared_inbox_enhancements.sql
-- Tables: tags (alter), contact_tags (policy alter), conversations (policy alter), messages (policy alter), inbox_timeline_events (new)
-- ============================================================

-- 1. Alter tags table to support multi-tenancy (add organization_id)
ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Backfill organization_id for existing tags based on creator's active organization
UPDATE public.tags t
SET organization_id = ou.organization_id
FROM public.organization_users ou
WHERE t.user_id = ou.user_id AND t.organization_id IS NULL;

-- Fallback for any tags that couldn't be resolved: set to first organization
UPDATE public.tags
SET organization_id = (SELECT id FROM public.organizations LIMIT 1)
WHERE organization_id IS NULL;

-- Now enforce NOT NULL constraint
ALTER TABLE public.tags ALTER COLUMN organization_id SET NOT NULL;

-- Create index for organization lookup
CREATE INDEX IF NOT EXISTS idx_tags_organization ON public.tags(organization_id);

-- 2. Restructure RLS policies for Shared Collaborative access

-- A. Tags Policies
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own tags" ON public.tags;
DROP POLICY IF EXISTS "Org members can manage tags" ON public.tags;
CREATE POLICY "Org members can manage tags" ON public.tags
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- B. Contact Tags Policies
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage contact tags" ON public.contact_tags;
DROP POLICY IF EXISTS "Org members can manage contact tags" ON public.contact_tags;
CREATE POLICY "Org members can manage contact tags" ON public.contact_tags
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.contacts 
      WHERE contacts.id = contact_tags.contact_id 
        AND contacts.organization_id IN (SELECT get_user_organizations())
    )
  );

-- C. Conversations Policies
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Org members can manage conversations" ON public.conversations;
CREATE POLICY "Org members can manage conversations" ON public.conversations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.contacts 
      WHERE contacts.id = conversations.contact_id 
        AND contacts.organization_id IN (SELECT get_user_organizations())
    )
  );

-- D. Messages Policies
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own messages" ON public.messages;
DROP POLICY IF EXISTS "Org members can manage messages" ON public.messages;
CREATE POLICY "Org members can manage messages" ON public.messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.conversations
      JOIN public.contacts ON conversations.contact_id = contacts.id
      WHERE conversations.id = messages.conversation_id
        AND contacts.organization_id IN (SELECT get_user_organizations())
    )
  );


-- 3. Create inbox_timeline_events table for Customer Timeline
CREATE TABLE IF NOT EXISTS public.inbox_timeline_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id   UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL CHECK (event_type IN (
    'status_change', 
    'assignment_change', 
    'note_added', 
    'tag_added', 
    'tag_removed', 
    'message_sent', 
    'ai_escalated', 
    'conversation_merged'
  )),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast chronological query
CREATE INDEX IF NOT EXISTS idx_inbox_timeline_org ON public.inbox_timeline_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_inbox_timeline_conv ON public.inbox_timeline_events(conversation_id);

-- RLS policies for inbox_timeline_events
ALTER TABLE public.inbox_timeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can manage timeline events" ON public.inbox_timeline_events;
CREATE POLICY "Org members can manage timeline events" ON public.inbox_timeline_events
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- Attach Audit Logging Trigger
DROP TRIGGER IF EXISTS audit_inbox_timeline_events ON public.inbox_timeline_events;
CREATE TRIGGER audit_inbox_timeline_events
  AFTER INSERT OR UPDATE OR DELETE ON public.inbox_timeline_events
  FOR EACH ROW EXECUTE FUNCTION process_audit_logging();
