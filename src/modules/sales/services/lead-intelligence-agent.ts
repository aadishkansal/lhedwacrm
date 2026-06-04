// src/modules/sales/services/lead-intelligence-agent.ts

import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { supabaseAdmin } from '../../workflows/services/admin-client';
import { LeadIntelligenceInsights } from '../types';

const leadIntelligenceSchema = z.object({
  score: z.number().min(0).max(100).describe('An overall lead intelligence index from 0 to 100'),
  conversionProbability: z.number().min(0).max(100).describe('Probability from 0 to 100 that this lead converts to a completed sale'),
  churnRisk: z.number().min(0).max(100).describe('Probability from 0 to 100 that this lead will churn or drop out of the pipeline'),
  likelyObjections: z.array(z.string()).describe('An array of objections this lead has raised or is likely to raise'),
  nextBestAction: z.string().describe('The single recommended next best action for the sales representative'),
  followupSuggestions: z.array(
    z.object({
      type: z.string().describe('Type of suggested followup (e.g. "whatsapp", "call", "email", "site_visit")'),
      description: z.string().describe('Details of what the followup should cover'),
      recommendedTime: z.string().optional().describe('Relative timeline suggestion (e.g. "tomorrow morning", "in 3 days")'),
    })
  ).describe('List of structured followup suggestions'),
});

export type LeadIntelligenceOutput = z.infer<typeof leadIntelligenceSchema>;

export interface LeadIntelligenceRunParams {
  contactId: string;
  organizationId: string;
  conversationId?: string;
  additionalContext?: {
    contactName?: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    memoryContext?: string;
  };
}

export class LeadIntelligenceAgent {
  /**
   * Run the lead intelligence analysis.
   * Fetches historical source tables, performs LLM analysis using Gemini, and saves insights.
   */
  async run(params: LeadIntelligenceRunParams): Promise<LeadIntelligenceInsights> {
    const startedAt = Date.now();
    console.log(`[LeadIntelligenceAgent] Running intelligence analysis for contact ${params.contactId}`);
    
    const db = supabaseAdmin();

    // 1. Fetch historical source CRM records
    const [
      { data: followUps },
      { data: stageHistory },
      { data: lostReasons },
      { data: proposals },
      { data: convertedLeads },
      { data: rawContact }
    ] = await Promise.all([
      db.from('lead_follow_ups').select('*').eq('contact_id', params.contactId).order('scheduled_at', { ascending: false }),
      db.from('lead_stage_history').select('*').eq('contact_id', params.contactId).order('entered_at', { ascending: false }),
      db.from('lead_lost_reasons').select('*').eq('contact_id', params.contactId).order('lost_at', { ascending: false }),
      db.from('proposal').select('*').eq('contact_id', params.contactId).order('created_at', { ascending: false }),
      db.from('converted_leads').select('*').eq('contact_id', params.contactId).order('converted_at', { ascending: false }),
      db.from('contacts').select('name, phone, email, company').eq('id', params.contactId).single()
    ]);

    // 2. Assemble context prompt
    const contactName = params.additionalContext?.contactName || rawContact?.name || 'Unknown customer';
    const historyText = params.additionalContext?.conversationHistory
      ? params.additionalContext.conversationHistory.map(h => `${h.role}: ${h.content}`).join('\n')
      : 'No recent chat history available.';

    const systemSizeKw = proposals?.[0]?.total_amount ? Math.round(proposals[0].total_amount / 75000) : 'unknown'; // rough estimation for prompt context

    const contextPrompt = `
=== CUSTOMER PROFILE ===
Name: ${contactName}
Phone: ${rawContact?.phone ?? 'unknown'}
Email: ${rawContact?.email ?? 'unknown'}
Company: ${rawContact?.company ?? 'none'}

=== HISTORICAL PROPOSAL DETAILS ===
${proposals && proposals.length > 0 
  ? proposals.map(p => `- Title: ${p.title} | Status: ${p.status} | Amount: ₹${p.total_amount.toLocaleString()}`).join('\n')
  : 'No proposals found.'}

=== LEAD STAGE HISTORY ===
${stageHistory && stageHistory.length > 0
  ? stageHistory.map(s => `- Stage: ${s.stage_name} | Entered: ${s.entered_at} | Exited: ${s.exited_at ?? 'Active'} | Duration: ${s.duration_days ?? 'ongoing'} days`).join('\n')
  : 'No lead stage history recorded.'}

=== LEAD FOLLOW-UP HISTORY ===
${followUps && followUps.length > 0
  ? followUps.map(f => `- Status: ${f.status} | Notes: ${f.notes ?? 'None'} | Scheduled: ${f.scheduled_at} | Completed: ${f.completed_at ?? 'No'}`).join('\n')
  : 'No follow-up records found.'}

=== LEAD LOST HISTORY ===
${lostReasons && lostReasons.length > 0
  ? lostReasons.map(l => `- Reason: ${l.reason} | Details: ${l.details ?? 'None'} | Date: ${l.lost_at}`).join('\n')
  : 'No lost lead records found.'}

=== LEAD CONVERSION RECORD ===
${convertedLeads && convertedLeads.length > 0
  ? convertedLeads.map(c => `- Converted at: ${c.converted_at} | Value: ₹${c.value?.toLocaleString() ?? 'unknown'}`).join('\n')
  : 'This lead has not been marked as converted yet.'}

=== ADDITIONAL SALES MEMORIES ===
${params.additionalContext?.memoryContext || 'No additional sales memory context available.'}

=== RECENT WHATSAPP CHAT HISTORY ===
${historyText}

=== SOLAR DESIGN REFERENCE ===
Estimated system size needed: ${systemSizeKw} kW.
`;

    // 3. Invoke LLM to perform prediction
    const systemPrompt = `You are a Lead Intelligence AI Agent for a Solar EPC company.
Analyze the customer's historical CRM records and recent conversation context to produce predictive intelligence insights.

Based on the provided data, generate:
1. Lead Score (0 to 100): General sales health and engagement index.
2. Conversion Probability (0.0 to 100.0): Estimated likelihood that this lead will convert to a completed sale.
3. Churn Risk (0.0 to 100.0): Probability that the lead will disengage, go cold, or go to a competitor.
4. Likely Objections: Objections this customer has raised or is likely to raise (e.g. high price, long installation timeline, warranty concerns, shading/structural roof doubts).
5. Next Best Action: The single most impactful step the sales team should take next.
6. Followup Suggestions: Chronological, actionable follow-up tasks with a suggested time and type.

Output a structured JSON object complying with the specified schema.`;

    const { object: output } = await generateObject({
      model: google('gemini-2.5-flash'),
      schema: leadIntelligenceSchema,
      system: systemPrompt,
      prompt: contextPrompt,
      temperature: 0.2,
    });

    console.log(`[LeadIntelligenceAgent] Insights generated for ${contactName}: Score: ${output.score}, Churn: ${output.churnRisk}%, Objections: ${output.likelyObjections.join(', ')}`);

    // 4. Save Insights separately to lead_intelligence_insights
    const { data: savedData, error: dbError } = await db
      .from('lead_intelligence_insights')
      .upsert({
        organization_id: params.organizationId,
        contact_id: params.contactId,
        score: output.score,
        conversion_probability: output.conversionProbability,
        likely_objections: output.likelyObjections,
        churn_risk: output.churnRisk,
        next_best_action: output.nextBestAction,
        followup_suggestions: output.followupSuggestions,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,contact_id' })
      .select()
      .single();

    if (dbError || !savedData) {
      console.error('[LeadIntelligenceAgent] Failed to upsert intelligence insights:', dbError?.message);
      throw new Error(`Failed to upsert intelligence insights: ${dbError?.message}`);
    }

    const elapsed = Date.now() - startedAt;
    console.log(`[LeadIntelligenceAgent] Completed run in ${elapsed}ms`);

    // 5. Return mapped model
    return {
      id: savedData.id,
      organizationId: savedData.organization_id,
      contactId: savedData.contact_id,
      score: savedData.score,
      conversionProbability: Number(savedData.conversion_probability),
      likelyObjections: savedData.likely_objections,
      churnRisk: Number(savedData.churn_risk),
      nextBestAction: savedData.next_best_action,
      followupSuggestions: savedData.followup_suggestions as any,
      createdAt: savedData.created_at,
      updatedAt: savedData.updated_at,
    };
  }

  /**
   * Retrieves the latest stored intelligence insights for a contact.
   */
  async getLatestInsights(params: { contactId: string; organizationId: string }): Promise<LeadIntelligenceInsights | null> {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('lead_intelligence_insights')
      .select('*')
      .eq('contact_id', params.contactId)
      .eq('organization_id', params.organizationId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id,
      organizationId: data.organization_id,
      contactId: data.contact_id,
      score: data.score,
      conversionProbability: Number(data.conversion_probability),
      likelyObjections: data.likely_objections,
      churnRisk: Number(data.churn_risk),
      nextBestAction: data.next_best_action,
      followupSuggestions: data.followup_suggestions as any,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}

export const leadIntelligenceAgent = new LeadIntelligenceAgent();
