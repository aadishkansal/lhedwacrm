// src/modules/agents/services/supervisor-agent.ts

import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { supabaseAdmin } from '../../workflows/services/admin-client';
import { customerContextService } from '../../crm/services/customer-context-service';
import {
  runSalesAgent,
  runSupportAgent,
  runInstallationAgent,
  runFinanceAgent,
  DepartmentAgentParams
} from './department-agents';
import { engineSendText } from '../../workflows/services/meta-send';

// Zod schema for structured output validation
const supervisorDecisionSchema = z.object({
  detectedIntent: z.string().describe('The core intent detected in the customer message'),
  classifiedDept: z.enum(['Sales', 'Support', 'Installation', 'Finance']).describe('Which department this message belongs to'),
  confidence: z.number().min(0.0).max(1.0).describe('Confidence score of the classification'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).describe('Priority level of the message'),
  humanHandoff: z.boolean().describe('Whether this query requires immediate human agent intervention'),
  escalationReason: z.string().optional().describe('Reason for human handoff or escalation if confidence is low'),
  routingDecision: z.enum(['route_to_agent', 'escalate_to_human', 'no_action']).describe('The final supervisor routing decision'),
});

export type SupervisorDecision = z.infer<typeof supervisorDecisionSchema>;

export interface SupervisorRouteParams {
  contactId: string;
  organizationId: string;
  conversationId: string;
  messageText: string;
  userId: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export class SupervisorAgent {
  /**
   * Main routing endpoint for incoming WhatsApp messages.
   */
  async routeMessage(params: SupervisorRouteParams): Promise<string> {
    console.log(`[SupervisorAgent] Routing message for contact ${params.contactId}`);
    const db = supabaseAdmin();
    const history = params.history || [];

    // 1. Customer Context Retrieval
    const customerContext = await customerContextService.getCustomerContextByContactId(params.contactId);

    // 2. Load and build Supervisor Prompt dynamically
    const { agentLoader } = await import('./agent-loader');
    const { PromptBuilder } = await import('./prompt-builder');
    
    const config = await agentLoader.loadAgent(params.organizationId, 'supervisor');
    const supervisorPrompt = PromptBuilder.buildPrompt(config.systemPrompt, {
      customerContext,
      messageText: params.messageText,
    });
 
    const { object: decision } = await generateObject({
      model: google(config.model),
      schema: supervisorDecisionSchema,
      system: "You are an AI Supervisor Agent that routes messages to departments or escalates.",
      prompt: supervisorPrompt,
      temperature: config.temperature,
    });

    console.log(`[SupervisorAgent] Classification: ${decision.classifiedDept} (Confidence: ${decision.confidence.toFixed(2)}, Priority: ${decision.priority})`);
    console.log(`[SupervisorAgent] Final Decision: ${decision.routingDecision}`);

    // 3. Persist log telemetry to supervisor_routing_decisions
    const { error: dbError } = await db
      .from('supervisor_routing_decisions')
      .insert({
        organization_id: params.organizationId,
        contact_id: params.contactId,
        conversation_id: params.conversationId,
        message_text: params.messageText,
        detected_intent: decision.detectedIntent,
        classified_dept: decision.classifiedDept,
        confidence: decision.confidence,
        priority: decision.priority,
        human_handoff: decision.humanHandoff,
        escalation_reason: decision.escalationReason || null,
        routing_decision: decision.routingDecision,
      });

    if (dbError) {
      console.error('[SupervisorAgent] Telemetry logging failed:', dbError.message);
    }

    // 4. Execute routing action
    if (decision.routingDecision === 'escalate_to_human' || decision.humanHandoff) {
      console.log(`[SupervisorAgent] Escalating to human. Reason: ${decision.escalationReason || 'Explicit request or low confidence'}`);
      await this.triggerHumanHandoff({
        userId: params.userId,
        conversationId: params.conversationId,
        contactId: params.contactId,
        organizationId: params.organizationId,
        department: decision.classifiedDept,
        escalationReason: decision.escalationReason || 'Transferred by supervisor',
      });
      return "I'm transferring you to a human agent. They will review our history and help you shortly. Please wait.";
    }

    const agentParams: DepartmentAgentParams = {
      contactId: params.contactId,
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      userId: params.userId,
      messageText: params.messageText,
      history,
      customerContext,
    };

    // Route to Selected Agent
    let replyText = '';
    switch (decision.classifiedDept) {
      case 'Sales':
        replyText = await runSalesAgent(agentParams);
        break;
      case 'Support':
        replyText = await runSupportAgent(agentParams);
        break;
      case 'Installation':
        replyText = await runInstallationAgent(agentParams);
        break;
      case 'Finance':
        replyText = await runFinanceAgent(agentParams);
        break;
      default:
        replyText = await runSalesAgent(agentParams);
    }

    return replyText;
  }

  /**
   * Helper to perform human escalation.
   */
  private async triggerHumanHandoff(params: {
    userId: string;
    conversationId: string;
    contactId: string;
    organizationId: string;
    department: 'Sales' | 'Support' | 'Installation' | 'Finance';
    escalationReason: string;
  }): Promise<void> {
    const db = supabaseAdmin();
    
    // 1. Run team routing engine to auto-assign a human agent in that department based on workload balancing
    const { teamRoutingService } = await import('./team-routing-service');
    const { assignedAgentId } = await teamRoutingService.routeConversation({
      conversationId: params.conversationId,
      organizationId: params.organizationId,
      department: params.department,
      isEscalation: true,
    });

    // 2. If no agent was found (assignedAgentId is null), fallback to params.userId
    if (!assignedAgentId) {
      await db
        .from('conversations')
        .update({
          assigned_agent_id: params.userId,
          assigned_department: params.department,
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.conversationId);
    }

    // 3. Save summary contact note
    await db.from('contact_notes').insert({
      contact_id: params.contactId,
      user_id: assignedAgentId || params.userId,
      note_text: `[Supervisor Handoff Log]\nEscalation Reason: ${params.escalationReason}\nDepartment: ${params.department}`,
    });
  }
}
export const supervisorAgent = new SupervisorAgent();
