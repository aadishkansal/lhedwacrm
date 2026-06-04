// src/modules/sales/services/sales-agent.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { engineSendText } from '../../workflows/services/meta-send';
import { AIService } from '../../agents/services/ai-service';
import { CRMDataLoader } from './crm-data-loader';
import { LeadScoringEngine } from './lead-scoring-engine';
import { FollowupGenerator } from './followup-generator';
import { leadIntelligenceAgent } from './lead-intelligence-agent';
import { SalesContext, SalesDecision, SalesAction } from '../types';

const SYSTEM_PROMPT = `You are a senior AI Sales Agent for a Solar EPC (Engineering, Procurement & Construction) company.
Your job is to analyse a customer's CRM profile and decide the single best sales action to take right now.

Available actions:
- SEND_FOLLOWUP: Send a nurture/follow-up WhatsApp message when the lead needs warming up.
- EXPLAIN_QUOTATION: The customer has a pending quote — explain it and address objections.
- RECOMMEND_PRODUCT: Recommend the best solar system configuration based on their requirements.
- BOOK_APPOINTMENT: Offer a site visit or sales call appointment.
- QUALIFY_LEAD: Ask qualification questions to determine budget, timeline, and requirements.
- ESCALATE_TO_HUMAN: The situation needs a human sales agent (complex negotiation, legal queries, etc.).
- NO_ACTION: The lead is actively engaged — no further action needed right now.

Decision rules:
- If lead score is HOT (>= 66) and a quote exists but hasn't been accepted → EXPLAIN_QUOTATION.
- If lead score is HOT and no project yet → BOOK_APPOINTMENT (site survey).
- If lead score is WARM (31–65) and no quote → RECOMMEND_PRODUCT or SEND_FOLLOWUP.
- If lead score is COLD (< 31) and last contact > 14 days → SEND_FOLLOWUP (win-back).
- If customer explicitly asked a complex technical/legal question → ESCALATE_TO_HUMAN.
- If customer recently responded and engagement is high → assess carefully.

Output a JSON object with these fields (no markdown wrapping):
{
  "action": "<SalesAction>",
  "reasoning": "<concise explanation of why you chose this action>",
  "urgency": "low" | "medium" | "high",
  "followupMessage": "<optional — only if action is SEND_FOLLOWUP, EXPLAIN_QUOTATION, or RECOMMEND_PRODUCT>",
  "appointmentType": "<optional — 'site_visit' | 'sales_call' | 'installation_review' | 'followup_call'>",
  "appointmentNotes": "<optional — context for the appointment>",
  "productRecommendation": {
    "systemSizeKw": <number>,
    "panelType": "<string>",
    "inverterType": "<string>",
    "estimatedCost": <number>,
    "reasoning": "<string>"
  }
}
Only include fields that are relevant to the chosen action. Always include "action", "reasoning", and "urgency".`;

export interface SalesAgentRunParams {
  contactId: string;
  organizationId: string;
  conversationId?: string;
  incomingMessage?: string;
  userId?: string;        // for WhatsApp reply sending
}

export interface SalesAgentResult {
  decision: SalesDecision;
  context: SalesContext;
  decisionId: string;
}

export class SalesAgent {
  private aiService = new AIService();
  private dataLoader = new CRMDataLoader();
  private scoringEngine = new LeadScoringEngine();
  private followupGen = new FollowupGenerator();

  async run(params: SalesAgentRunParams): Promise<SalesAgentResult> {
    const startedAt = Date.now();
    console.log(`[SalesAgent] Starting run for contact ${params.contactId}`);

    // 1. Load full CRM context
    const context = await this.dataLoader.loadContext({
      contactId: params.contactId,
      organizationId: params.organizationId,
      incomingMessage: params.incomingMessage,
      query: params.incomingMessage,
    });

    // 2. Score the lead and persist
    const leadScore = await this.scoringEngine.scoreAndPersist({
      contactId: params.contactId,
      organizationId: params.organizationId,
      signals: context.signals,
    });
    context.leadScore = leadScore;

    // Run LeadIntelligenceAgent to calculate predictive insights and persist them
    try {
      const leadIntelligence = await leadIntelligenceAgent.run({
        contactId: params.contactId,
        organizationId: params.organizationId,
        conversationId: params.conversationId,
        additionalContext: {
          contactName: context.contact.name,
          conversationHistory: context.conversationHistory,
          memoryContext: context.memoryContext,
        },
      });
      context.leadIntelligence = leadIntelligence;
    } catch (err: any) {
      console.error(`[SalesAgent] LeadIntelligenceAgent execution failed: ${err.message}`);
    }

    console.log(`[SalesAgent] Lead score: ${leadScore.score}/100 (${leadScore.band})`);

    // 3. Build the context prompt for the LLM
    const contextSummary = this.buildContextSummary(context);

    // 4. Ask LLM to decide the next best action
    const aiResponse = await this.aiService.generate({
      modelId: 'gemini-2.5-flash',
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contextSummary }],
      organizationId: params.organizationId,
      sessionId: params.conversationId ?? params.contactId,
      agentName: 'SalesAgent',
      temperature: 0.3, // Low temperature for consistent, structured decisions
    });

    // 5. Parse decision
    const decision = this.parseDecision(aiResponse.text);
    console.log(`[SalesAgent] Decision: ${decision.action} (urgency: ${decision.urgency})`);

    // 6. Execute the decided action
    await this.executeAction({
      decision,
      context,
      userId: params.userId,
      conversationId: params.conversationId,
    });

    // 7. Log the decision
    const decisionId = await this.logDecision({
      decision,
      context,
      organizationId: params.organizationId,
      conversationId: params.conversationId,
    });

    const elapsed = Date.now() - startedAt;
    console.log(`[SalesAgent] Run complete in ${elapsed}ms. Decision ID: ${decisionId}`);

    return { decision, context, decisionId };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildContextSummary(context: SalesContext): string {
    const { contact, deal, project, quote, signals, leadScore, conversationHistory, memoryContext, incomingMessage, leadIntelligence } = context;

    const lines: string[] = [
      '=== CUSTOMER CRM PROFILE ===',
      `Name: ${contact.name ?? 'Unknown'}`,
      `Phone: ${contact.phone}`,
      contact.company ? `Company: ${contact.company}` : '',
      ``,
      '=== LEAD SCORE ===',
      `Score: ${leadScore.score}/100 | Band: ${leadScore.band.toUpperCase()}`,
      `Breakdown: ${JSON.stringify(leadScore.breakdown)}`,
      ``,
      '=== DEAL ===',
      deal
        ? `Title: ${deal.title} | Stage: ${deal.stageName} | Value: ₹${deal.value.toLocaleString()} | Status: ${deal.status}`
        : 'No active deal in CRM.',
      ``,
      '=== PROJECT ===',
      project
        ? `Status: ${project.status}${project.systemSizeKw ? ` | Size: ${project.systemSizeKw}kW` : ''}${project.address ? ` | Address: ${project.address}` : ''}`
        : 'No EPC project found.',
      ``,
      '=== QUOTATION ===',
      quote
        ? `Amount: ₹${quote.totalAmount.toLocaleString()} | Status: ${quote.status} | Created: ${quote.createdAt.slice(0, 10)}`
        : 'No quotation issued.',
      ``,
      '=== ENGAGEMENT SIGNALS ===',
      `Days since last contact: ${signals.daysSinceLastContact}`,
      `Total messages: ${signals.messageCount}`,
      `Responded in 24h: ${signals.responsed24h}`,
      `Site visit scheduled: ${signals.hasScheduledVisit}`,
      `Memory facts stored: ${signals.memoryFactCount}`,
      ``,
    ];

    if (leadIntelligence) {
      lines.push(
        '=== AI LEAD INTELLIGENCE ===',
        `Predictive Lead Score: ${leadIntelligence.score}/100`,
        `Conversion Probability: ${leadIntelligence.conversionProbability}%`,
        `Churn Risk: ${leadIntelligence.churnRisk}%`,
        `Likely Objections: ${leadIntelligence.likelyObjections.join(', ') || 'None identified'}`,
        `Recommended Next Best Action: ${leadIntelligence.nextBestAction}`,
        `Suggested Follow-ups: ${JSON.stringify(leadIntelligence.followupSuggestions)}`,
        ''
      );
    }

    if (memoryContext) {
      lines.push('=== CUSTOMER MEMORY ===', memoryContext, '');
    }

    if (conversationHistory.length > 0) {
      lines.push('=== RECENT CONVERSATION ===');
      conversationHistory.slice(-6).forEach(m => {
        lines.push(`[${m.role.toUpperCase()}]: ${m.content}`);
      });
      lines.push('');
    }

    if (incomingMessage) {
      lines.push('=== LATEST MESSAGE FROM CUSTOMER ===', incomingMessage, '');
    }

    lines.push('Based on this profile, decide the single best next action. Output only the JSON decision object.');

    return lines.filter(l => l !== null).join('\n');
  }

  private parseDecision(rawText: string): SalesDecision {
    try {
      const clean = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean);

      const validActions: SalesAction[] = [
        'SEND_FOLLOWUP', 'EXPLAIN_QUOTATION', 'RECOMMEND_PRODUCT',
        'BOOK_APPOINTMENT', 'QUALIFY_LEAD', 'ESCALATE_TO_HUMAN', 'NO_ACTION',
      ];

      const action: SalesAction = validActions.includes(parsed.action)
        ? parsed.action
        : 'SEND_FOLLOWUP';

      return {
        action,
        reasoning: parsed.reasoning ?? 'No reasoning provided.',
        urgency: parsed.urgency ?? 'medium',
        followupMessage: parsed.followupMessage,
        appointmentType: parsed.appointmentType,
        appointmentNotes: parsed.appointmentNotes,
        productRecommendation: parsed.productRecommendation,
      };
    } catch (err: any) {
      console.error('[SalesAgent] Failed to parse LLM decision:', err.message, '\nRaw:', rawText);
      return {
        action: 'SEND_FOLLOWUP',
        reasoning: 'Decision parsing failed; defaulting to follow-up.',
        urgency: 'low',
      };
    }
  }

  private async executeAction(params: {
    decision: SalesDecision;
    context: SalesContext;
    userId?: string;
    conversationId?: string;
  }): Promise<void> {
    const { decision, context, userId, conversationId } = params;
    const admin = supabaseAdmin();

    switch (decision.action) {
      case 'SEND_FOLLOWUP':
      case 'EXPLAIN_QUOTATION':
      case 'RECOMMEND_PRODUCT': {
        // Generate message if LLM didn't provide one
        let message = decision.followupMessage;
        if (!message) {
          const template = this.followupGen.selectTemplate(decision.action, context);
          const generated = await this.followupGen.generate({ context, template });
          message = generated.text;
        }

        // Send via WhatsApp if we have user + conversation IDs
        if (userId && conversationId && context.contact.id) {
          try {
            await engineSendText({
              userId,
              conversationId,
              contactId: context.contact.id,
              text: message,
            });
            console.log(`[SalesAgent] WhatsApp message sent for action: ${decision.action}`);
          } catch (err: any) {
            console.error('[SalesAgent] WhatsApp send failed:', err.message);
          }
        }
        break;
      }

      case 'BOOK_APPOINTMENT': {
        // Book an appointment 2 business days from now at 10am
        const scheduledAt = new Date();
        scheduledAt.setDate(scheduledAt.getDate() + 2);
        scheduledAt.setHours(10, 0, 0, 0);

        const { data: appt, error: apptErr } = await admin
          .from('appointments')
          .insert({
            organization_id: context.contact.organizationId,
            contact_id: context.contact.id,
            deal_id: context.deal?.id ?? null,
            project_id: context.project?.id ?? null,
            scheduled_at: scheduledAt.toISOString(),
            appointment_type: decision.appointmentType ?? 'site_visit',
            notes: decision.appointmentNotes ?? null,
            booked_by: 'SalesAgent',
          })
          .select('id')
          .single();

        if (apptErr) {
          console.error('[SalesAgent] Failed to book appointment:', apptErr.message);
        } else {
          console.log(`[SalesAgent] Appointment booked: ${appt?.id}`);
        }

        // Send WhatsApp confirmation
        if (userId && conversationId) {
          const confirmMsg = await this.followupGen.generate({
            context,
            template: 'appointment_confirmation',
            extraInstructions: `Appointment scheduled for ${scheduledAt.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at 10:00 AM.`,
          });
          try {
            await engineSendText({
              userId,
              conversationId,
              contactId: context.contact.id,
              text: confirmMsg.text,
            });
            // Mark as whatsapp_sent
            if (appt?.id) {
              await admin.from('appointments').update({ whatsapp_sent: true }).eq('id', appt.id);
            }
          } catch (err: any) {
            console.error('[SalesAgent] WhatsApp confirmation send failed:', err.message);
          }
        }
        break;
      }

      case 'ESCALATE_TO_HUMAN': {
        // Mark conversation as needing human attention by clearing assigned_agent
        // (no assignment = routed to inbox for manual pickup)
        if (conversationId) {
          await admin
            .from('conversations')
            .update({ status: 'open' })
            .eq('id', conversationId);
        }

        // Optionally send a transition message
        if (userId && conversationId) {
          const handoffMsg = `Thank you for your query! 🙏 I'm connecting you with one of our solar experts who will be in touch shortly. They'll have full context about your project.`;
          try {
            await engineSendText({
              userId,
              conversationId,
              contactId: context.contact.id,
              text: handoffMsg,
            });
          } catch (err: any) {
            console.error('[SalesAgent] Escalation WhatsApp send failed:', err.message);
          }
        }
        console.log(`[SalesAgent] Escalated to human. Conversation ${conversationId} reopened.`);
        break;
      }

      case 'QUALIFY_LEAD': {
        // Generate a qualification question set
        const qualifyMsg = decision.followupMessage ?? `Hi ${context.contact.name ?? 'there'}! To help us give you the best solar recommendation, could you share:\n1. Approximate monthly electricity bill (₹)\n2. Roof area available (sq ft)\n3. Timeline to install solar\nThis helps us design the right system for you! 🌞`;

        if (userId && conversationId) {
          try {
            await engineSendText({
              userId,
              conversationId,
              contactId: context.contact.id,
              text: qualifyMsg,
            });
          } catch (err: any) {
            console.error('[SalesAgent] Qualify lead message send failed:', err.message);
          }
        }
        break;
      }

      case 'NO_ACTION':
      default:
        console.log(`[SalesAgent] Action is NO_ACTION. No message sent.`);
        break;
    }
  }

  private async logDecision(params: {
    decision: SalesDecision;
    context: SalesContext;
    organizationId: string;
    conversationId?: string;
  }): Promise<string> {
    const admin = supabaseAdmin();
    const { decision, context, organizationId, conversationId } = params;

    const metadata: Record<string, unknown> = {};
    if (context.deal?.id) metadata.deal_id = context.deal.id;
    if (context.quote?.id) metadata.quote_id = context.quote.id;
    if (context.project?.id) metadata.project_id = context.project.id;
    if (decision.followupMessage) metadata.followup_text = decision.followupMessage;
    if (decision.appointmentType) metadata.appointment_type = decision.appointmentType;
    if (decision.productRecommendation) metadata.product_recommendation = decision.productRecommendation;
    metadata.urgency = decision.urgency;

    const { data, error } = await admin
      .from('agent_decisions')
      .insert({
        organization_id: organizationId,
        contact_id: context.contact.id,
        conversation_id: conversationId ?? null,
        agent_name: 'SalesAgent',
        action: decision.action,
        reasoning: decision.reasoning,
        lead_score: context.leadScore.score,
        lead_band: context.leadScore.band,
        metadata,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[SalesAgent] Failed to log decision:', error.message);
      return 'unknown';
    }

    return data?.id ?? 'unknown';
  }
}
