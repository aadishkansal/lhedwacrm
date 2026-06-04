import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';
import {
  triggerProjectUpdated,
  triggerProposalUpdated,
  triggerInstallationUpdated,
  triggerFollowupEvent,
  triggerTicketEvent,
  triggerInvoiceUpdated,
} from '@/modules/workflows/services/crm-event-triggers';

interface SupabaseWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: Record<string, any>;
  old_record: Record<string, any> | null;
}

export async function POST(request: Request) {
  try {
    // Optional secret verification
    const secret = process.env.CRM_WEBHOOK_SECRET;
    if (secret) {
      const supplied = request.headers.get('x-webhook-secret');
      if (supplied !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const payload = (await request.json()) as SupabaseWebhookPayload;
    if (!payload || !payload.table || !payload.record) {
      return NextResponse.json({ error: 'Invalid payload structure' }, { status: 400 });
    }

    const db = supabaseAdmin();
    const { table, type, record, old_record } = payload;

    // Helper: Resolve a user ID belonging to the organization to act as context/owner
    const resolveOrgUser = async (orgId: string): Promise<string> => {
      const { data } = await db
        .from('organization_users')
        .select('user_id')
        .eq('organization_id', orgId)
        .order('role', { ascending: false }) // Prioritize owners/admins
        .limit(1)
        .maybeSingle();
      if (!data?.user_id) throw new Error(`No user found in organization ${orgId}`);
      return data.user_id;
    };

    // Helper: Resolve contact_id from a project_id
    const resolveContactIdFromProject = async (projectId: string): Promise<string> => {
      const { data } = await db
        .from('epc_projects')
        .select('contact_id')
        .eq('id', projectId)
        .single();
      if (!data?.contact_id) throw new Error(`No contact linked to project ${projectId}`);
      return data.contact_id;
    };

    console.log(`[CRM Webhook] Processing event ${type} on table ${table}`);

    switch (table) {
      case 'epc_projects': {
        // Trigger on INSERT or status update
        if (type === 'INSERT' || record.status !== old_record?.status) {
          if (!record.contact_id) return NextResponse.json({ success: true, reason: 'No contact linked' });
          const userId = await resolveOrgUser(record.organization_id);
          await triggerProjectUpdated({
            userId,
            contactId: record.contact_id,
            projectId: record.id,
            status: record.status,
            systemSizeKw: record.system_size_kw ? Number(record.system_size_kw) : undefined,
            address: record.address,
          });
        }
        break;
      }

      case 'epc_quotes': {
        // Trigger on INSERT or status update
        if (type === 'INSERT' || record.status !== old_record?.status) {
          const userId = await resolveOrgUser(record.organization_id);
          const contactId = await resolveContactIdFromProject(record.project_id);
          await triggerProposalUpdated({
            userId,
            contactId,
            proposalId: record.id,
            status: record.status,
            totalAmount: Number(record.total_amount),
          });
        }
        break;
      }

      case 'installation_updates': {
        // Trigger on INSERT of an installation update
        if (type === 'INSERT') {
          const userId = await resolveOrgUser(record.organization_id);
          const contactId = await resolveContactIdFromProject(record.project_id);
          await triggerInstallationUpdated({
            userId,
            contactId,
            slotId: record.id,
            status: record.update_type,
            scheduledAt: record.created_at || new Date().toISOString(),
          });
        }
        break;
      }

      case 'appointments': {
        // Trigger on INSERT or changes to appointment status or time
        if (
          type === 'INSERT' ||
          record.status !== old_record?.status ||
          record.scheduled_at !== old_record?.scheduled_at
        ) {
          if (!record.contact_id) return NextResponse.json({ success: true, reason: 'No contact linked' });
          const userId = await resolveOrgUser(record.organization_id);
          await triggerFollowupEvent({
            userId,
            contactId: record.contact_id,
            followupId: record.id,
            status: record.status || 'pending',
            scheduledAt: record.scheduled_at,
            type: record.appointment_type,
            notes: record.notes,
          });
        }
        break;
      }

      case 'support_tickets': {
        // Trigger on INSERT or status update
        if (type === 'INSERT' || record.status !== old_record?.status) {
          if (!record.contact_id) return NextResponse.json({ success: true, reason: 'No contact linked' });
          const userId = await resolveOrgUser(record.organization_id);
          await triggerTicketEvent({
            userId,
            contactId: record.contact_id,
            ticketId: record.id,
            status: record.status,
            title: record.title,
            priority: record.priority,
          });
        }
        break;
      }

      case 'invoices': {
        // Trigger on INSERT or status update
        if (type === 'INSERT' || record.status !== old_record?.status) {
          if (!record.contact_id) return NextResponse.json({ success: true, reason: 'No contact linked' });
          const userId = await resolveOrgUser(record.organization_id);
          await triggerInvoiceUpdated({
            userId,
            contactId: record.contact_id,
            invoiceId: record.id,
            status: record.status,
            amount: Number(record.amount),
            dueDate: record.due_date,
          });
        }
        break;
      }

      default:
        return NextResponse.json({ success: true, reason: `Ignored table ${table}` });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(`[CRM Webhook Error] ${error.message || error}`);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
