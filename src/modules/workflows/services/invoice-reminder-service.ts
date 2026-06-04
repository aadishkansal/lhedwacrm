// src/modules/workflows/services/invoice-reminder-service.ts

import { supabaseAdmin } from './admin-client';
import { runAutomationsForTrigger } from './engine';

export class InvoiceReminderService {
  /**
   * Dispatches the invoice_updated trigger to the Workflow Engine.
   * If the invoice status is 'paid', it cancels any pending reminder wait steps.
   */
  async triggerInvoiceUpdated(params: {
    userId: string;
    contactId: string;
    invoiceId: string;
    status: string;
    amount: number;
    dueDate: string;
  }) {
    console.log(`[InvoiceReminderService] Triggering invoice_updated for invoice ${params.invoiceId} (status: ${params.status})`);
    
    // 1. Run workflow engine automations matching invoice_updated
    await runAutomationsForTrigger({
      userId: params.userId,
      triggerType: 'invoice_updated',
      contactId: params.contactId,
      context: {
        invoice_id: params.invoiceId,
        invoice_status: params.status,
        invoice_amount: params.amount,
        invoice_due_date: params.dueDate,
      },
    });

    // 2. If invoice is paid, cancel any pending wait reminders scheduled for it
    if (params.status === 'paid') {
      await this.cancelPendingInvoiceReminders(params.invoiceId);
    }
  }

  /**
   * Sets all pending wait executions for this invoice to 'done' (effectively cancelling them).
   * This is part of the Payment Confirmation Handling.
   */
  async cancelPendingInvoiceReminders(invoiceId: string): Promise<void> {
    console.log(`[InvoiceReminderService] Cancelling pending reminders for invoice ${invoiceId}`);
    const db = supabaseAdmin();
    
    // We update pending executions that contain the paid invoice_id in their context JSONB
    const { data, error } = await db
      .from('automation_pending_executions')
      .update({ status: 'done' })
      .eq('status', 'pending')
      .eq('context->>invoice_id', invoiceId);

    if (error) {
      console.error(`[InvoiceReminderService] Failed to cancel pending reminders for invoice ${invoiceId}:`, error.message);
    } else {
      console.log(`[InvoiceReminderService] Successfully cancelled pending reminders for invoice ${invoiceId}`);
    }
  }

  /**
   * Computes invoice reminder effectiveness stats for an organization.
   * Satisfies the "Track effectiveness" requirement.
   */
  async getReminderEffectiveness(organizationId: string) {
    const db = supabaseAdmin();

    // 1. Retrieve all invoices in the organization
    const { data: invoices, error: invError } = await db
      .from('invoices')
      .select('id, status, amount, paid_at, created_at')
      .eq('organization_id', organizationId)
      .is('deleted_at', null);

    if (invError || !invoices) {
      console.error('[InvoiceReminderService] Failed to fetch invoices for stats:', invError?.message);
      return this.emptyStats();
    }

    // 2. Retrieve all sent reminders for these invoices
    const invoiceIds = invoices.map(i => i.id);
    let reminders: any[] = [];
    if (invoiceIds.length > 0) {
      const { data: remRows, error: remError } = await db
        .from('invoice_reminders')
        .select('invoice_id, reminder_count, sent_at, status')
        .in('invoice_id', invoiceIds)
        .eq('status', 'sent');
      
      if (!remError && remRows) {
        reminders = remRows;
      }
    }

    // 3. Compute stats
    const totalInvoices = invoices.length;
    const paidInvoices = invoices.filter(i => i.status === 'paid');
    const totalPaidCount = paidInvoices.length;
    
    // Group reminders by invoice_id
    const remindersMap = new Map<string, typeof reminders>();
    reminders.forEach(r => {
      const list = remindersMap.get(r.invoice_id) || [];
      list.push(r);
      remindersMap.set(r.invoice_id, list);
    });

    let invoicesWithRemindersCount = 0;
    let paidWithRemindersCount = 0;
    let totalTimeDiffMs = 0;
    let timeDiffCount = 0;

    const distribution: Record<number, number> = {};

    invoices.forEach(inv => {
      const invReminders = remindersMap.get(inv.id) || [];
      const reminderCount = invReminders.length;

      if (reminderCount > 0) {
        invoicesWithRemindersCount++;
        
        // Distribution of reminders sent per invoice
        distribution[reminderCount] = (distribution[reminderCount] || 0) + 1;

        if (inv.status === 'paid') {
          paidWithRemindersCount++;

          // Compute average time to payment after first reminder
          const firstReminder = invReminders.reduce((earliest, cur) => {
            const curTime = new Date(cur.sent_at).getTime();
            const earliestTime = new Date(earliest.sent_at).getTime();
            return curTime < earliestTime ? cur : earliest;
          }, invReminders[0]);

          if (inv.paid_at && firstReminder.sent_at) {
            const paidTime = new Date(inv.paid_at).getTime();
            const sentTime = new Date(firstReminder.sent_at).getTime();
            if (paidTime >= sentTime) {
              totalTimeDiffMs += (paidTime - sentTime);
              timeDiffCount++;
            }
          }
        }
      }
    });

    const recoveryRate = invoicesWithRemindersCount > 0
      ? Math.round((paidWithRemindersCount / invoicesWithRemindersCount) * 100)
      : 0;

    const averageTimeToPaymentHours = timeDiffCount > 0
      ? Number((totalTimeDiffMs / (1000 * 60 * 60 * timeDiffCount)).toFixed(2))
      : 0;

    return {
      totalInvoices,
      totalPaid: totalPaidCount,
      totalRemindersSent: reminders.length,
      invoicesWithReminders: invoicesWithRemindersCount,
      paidWithReminders: paidWithRemindersCount,
      recoveryRate,
      averageTimeToPaymentHours,
      remindersSentPerInvoiceDistribution: distribution,
    };
  }

  private emptyStats() {
    return {
      totalInvoices: 0,
      totalPaid: 0,
      totalRemindersSent: 0,
      invoicesWithReminders: 0,
      paidWithReminders: 0,
      recoveryRate: 0,
      averageTimeToPaymentHours: 0,
      remindersSentPerInvoiceDistribution: {},
    };
  }
}

export const invoiceReminderService = new InvoiceReminderService();
