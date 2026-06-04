-- ============================================================
-- 031_crm_event_triggers.sql
-- Enables Supabase database webhooks for CRM Workflow Engine triggers
-- ============================================================

-- Enable the pg_net extension for network calls if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1. Create a generic function to send database webhook payloads
CREATE OR REPLACE FUNCTION public.handle_crm_database_webhook()
RETURNS TRIGGER 
SECURITY DEFINER
AS $$
DECLARE
  payload JSONB;
  webhook_url TEXT;
  webhook_secret TEXT;
  headers JSONB;
BEGIN
  -- Fallback url. In production, this can be configured in a table or env.
  webhook_url := 'http://localhost:3000/api/webhooks/crm';
  
  -- Gather optional webhook secret from a config table or use default/none
  webhook_secret := ''; 
  
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-webhook-secret', webhook_secret
  );

  payload := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'type', TG_OP,
    'schema', TG_TABLE_SCHEMA,
    'record', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW)::jsonb END,
    'old_record', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD)::jsonb END
  );

  -- Perform async HTTP POST via pg_net (returns request ID and does not block transaction)
  PERFORM net.http_post(
    url := webhook_url,
    body := payload,
    headers := headers,
    timeout_milliseconds := 5000
  );

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 2. Bind triggers to epc_projects
DROP TRIGGER IF EXISTS trg_webhook_epc_projects ON public.epc_projects;
CREATE TRIGGER trg_webhook_epc_projects
  AFTER INSERT OR UPDATE ON public.epc_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_crm_database_webhook();

-- 3. Bind triggers to epc_quotes
DROP TRIGGER IF EXISTS trg_webhook_epc_quotes ON public.epc_quotes;
CREATE TRIGGER trg_webhook_epc_quotes
  AFTER INSERT OR UPDATE ON public.epc_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_crm_database_webhook();

-- 4. Bind triggers to installation_updates
DROP TRIGGER IF EXISTS trg_webhook_installation_updates ON public.installation_updates;
CREATE TRIGGER trg_webhook_installation_updates
  AFTER INSERT ON public.installation_updates
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_crm_database_webhook();

-- 5. Bind triggers to appointments
DROP TRIGGER IF EXISTS trg_webhook_appointments ON public.appointments;
CREATE TRIGGER trg_webhook_appointments
  AFTER INSERT OR UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_crm_database_webhook();

-- 6. Bind triggers to support_tickets
DROP TRIGGER IF EXISTS trg_webhook_support_tickets ON public.support_tickets;
CREATE TRIGGER trg_webhook_support_tickets
  AFTER INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_crm_database_webhook();
