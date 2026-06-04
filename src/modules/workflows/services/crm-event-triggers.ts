import { runAutomationsForTrigger } from './engine';
import { invoiceReminderService } from './invoice-reminder-service';

export async function triggerProjectUpdated(params: {
  userId: string;
  contactId: string;
  projectId: string;
  status: string;
  systemSizeKw?: number;
  address?: string;
}) {
  await runAutomationsForTrigger({
    userId: params.userId,
    triggerType: 'project_updated',
    contactId: params.contactId,
    context: {
      project_id: params.projectId,
      project_status: params.status,
      system_size_kw: params.systemSizeKw,
      project_address: params.address,
    },
  });
}

export async function triggerProposalUpdated(params: {
  userId: string;
  contactId: string;
  proposalId: string;
  status: string;
  totalAmount: number;
}) {
  await runAutomationsForTrigger({
    userId: params.userId,
    triggerType: 'proposal_updated',
    contactId: params.contactId,
    context: {
      proposal_id: params.proposalId,
      proposal_status: params.status,
      total_amount: params.totalAmount,
    },
  });
}

export async function triggerInstallationUpdated(params: {
  userId: string;
  contactId: string;
  slotId: string;
  status: string;
  scheduledAt: string;
  installerName?: string;
}) {
  await runAutomationsForTrigger({
    userId: params.userId,
    triggerType: 'installation_updated',
    contactId: params.contactId,
    context: {
      installation_slot_id: params.slotId,
      installation_status: params.status,
      installation_scheduled_at: params.scheduledAt,
      installer_name: params.installerName,
    },
  });
}

export async function triggerFollowupEvent(params: {
  userId: string;
  contactId: string;
  followupId: string;
  status: string;
  scheduledAt: string;
  type: string;
  notes?: string;
}) {
  await runAutomationsForTrigger({
    userId: params.userId,
    triggerType: 'followup_event',
    contactId: params.contactId,
    context: {
      followup_id: params.followupId,
      followup_status: params.status,
      followup_scheduled_at: params.scheduledAt,
      followup_type: params.type,
      followup_notes: params.notes,
    },
  });
}

export async function triggerTicketEvent(params: {
  userId: string;
  contactId: string;
  ticketId: string;
  status: string;
  title: string;
  priority: string;
}) {
  await runAutomationsForTrigger({
    userId: params.userId,
    triggerType: 'ticket_event',
    contactId: params.contactId,
    context: {
      ticket_id: params.ticketId,
      ticket_status: params.status,
      ticket_title: params.title,
      ticket_priority: params.priority,
    },
  });
}

export async function triggerInvoiceUpdated(params: {
  userId: string;
  contactId: string;
  invoiceId: string;
  status: string;
  amount: number;
  dueDate: string;
}) {
  await invoiceReminderService.triggerInvoiceUpdated(params);
}
