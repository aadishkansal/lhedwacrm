// src/modules/agents/tools/index.ts

import { registry } from './registry';

// Import all tools
import { getCustomerContextTool } from './definitions/get-customer-context';
import { getProjectProgressTool } from './definitions/get-project-progress';
import { getProposalTool } from './definitions/get-proposal';
import { getInstallationScheduleTool } from './definitions/get-installation-schedule';
import { getInvoiceStatusTool } from './definitions/get-invoice-status';
import { getPendingFollowupsTool } from './definitions/get-pending-followups';
import { getCustomerDocumentsTool } from './definitions/get-customer-documents';
import { createSupportTicketTool } from './definitions/create-support-ticket';
import { assignHumanAgentTool } from './definitions/assign-human-agent';
import { sendWhatsAppMessageTool } from './definitions/send-whatsapp-message';

// Register all tools automatically
registry.register(getCustomerContextTool);
registry.register(getProjectProgressTool);
registry.register(getProposalTool);
registry.register(getInstallationScheduleTool);
registry.register(getInvoiceStatusTool);
registry.register(getPendingFollowupsTool);
registry.register(getCustomerDocumentsTool);
registry.register(createSupportTicketTool);
registry.register(assignHumanAgentTool);
registry.register(sendWhatsAppMessageTool);

// Exports
export * from './types';
export * from './registry';
export * from './executor';
export * from './definitions/get-customer-context';
export * from './definitions/get-project-progress';
export * from './definitions/get-proposal';
export * from './definitions/get-installation-schedule';
export * from './definitions/get-invoice-status';
export * from './definitions/get-pending-followups';
export * from './definitions/get-customer-documents';
export * from './definitions/create-support-ticket';
export * from './definitions/assign-human-agent';
export * from './definitions/send-whatsapp-message';
