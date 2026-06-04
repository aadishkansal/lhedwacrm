// src/modules/agents/tools/definitions/create-support-ticket.ts

import { z } from 'zod';
import { AgentTool } from '../types';
import { salesPortalConnector } from '../../../crm/services/sales-portal-connector';
import { triggerTicketEvent } from '../../../workflows/services/crm-event-triggers';

const inputSchema = z.object({
  contactId: z.string().uuid({ message: 'A valid contactId UUID is required' }),
  title: z.string().min(1, { message: 'Title cannot be empty' }),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  status: z.string().optional().default('open'),
});

export const createSupportTicketTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'CreateSupportTicket',
  description: 'Creates a new support ticket in the CRM for customer issues, warranty claims, or installation complaints.',
  schema: inputSchema,
  permissions: ['write:ticket'],
  handler: async (input, context) => {
    const ticket = await salesPortalConnector.createSupportTicket({
      contactId: input.contactId,
      title: input.title,
      priority: input.priority,
      status: input.status,
    });

    // Trigger Ticket Event workflow
    try {
      await triggerTicketEvent({
        userId: context.userId || context.organizationId,
        contactId: input.contactId,
        ticketId: ticket.id,
        status: ticket.status,
        title: ticket.title,
        priority: ticket.priority,
      });
    } catch (err) {
      console.error('[workflows] Failed to trigger ticket event workflow:', err);
    }

    return ticket;
  },
};
