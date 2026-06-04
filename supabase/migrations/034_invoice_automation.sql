-- ============================================================
-- 034_invoice_automation.sql
-- Binds webhook trigger to invoices table
-- ============================================================

DROP TRIGGER IF EXISTS trg_webhook_invoices ON public.invoices;
CREATE TRIGGER trg_webhook_invoices
  AFTER INSERT OR UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_crm_database_webhook();
