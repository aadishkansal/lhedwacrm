// src/modules/sales/services/sales-lead-cron.ts
// Inngest scheduled function: runs every day at 7:00 AM IST to re-evaluate warm leads.

import { inngest } from '../../../core/inngest/client';
import { supabaseAdmin } from '../../workflows/services/admin-client';
import { SalesAgent } from './sales-agent';

/**
 * Daily warm-lead re-evaluation cron.
 *
 * - Runs at 01:30 UTC (= 07:00 IST) every day.
 * - Fetches up to 50 contacts that have a warm/hot lead score and
 *   haven't had a Sales Agent decision in the last 24 hours.
 * - For each, runs a SalesAgent evaluation (no incoming message context).
 * - The agent will decide: follow-up, remind about quote, book appointment, etc.
 */
export const dailyLeadReEvaluation = inngest.createFunction(
  {
    id: 'daily-lead-re-evaluation',
    name: 'Daily Lead Re-Evaluation (Sales Agent Cron)',
    concurrency: { limit: 5 },
    triggers: [
      { cron: '30 1 * * *' }, // 01:30 UTC = 07:00 IST
    ],
  },
  async ({ step }: { step: any }) => {
    const logger = console;
    logger.info('[SalesCron] Starting daily lead re-evaluation...');

    const admin = supabaseAdmin();

    // 1. Find organizations with active leads
    const { data: orgs, error: orgErr } = await admin
      .from('organizations')
      .select('id')
      .limit(100);

    if (orgErr || !orgs) {
      logger.error('[SalesCron] Failed to fetch organizations:', orgErr?.message);
      return { evaluated: 0 };
    }

    let totalEvaluated = 0;

    for (const org of orgs) {
      const evaluated = await step.run(`evaluate-org-${org.id}`, async () => {
        const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // 2. Find contacts with warm/hot score that haven't been evaluated in 24h
        const { data: recentDecisionContacts } = await admin
          .from('agent_decisions')
          .select('contact_id')
          .eq('organization_id', org.id)
          .eq('agent_name', 'SalesAgent')
          .gte('created_at', cutoffDate);

        const recentlyEvaluatedIds = new Set(
          (recentDecisionContacts ?? []).map((r: { contact_id: string }) => r.contact_id)
        );

        // 3. Get warm/hot leads not recently evaluated
        const { data: warmLeads } = await admin
          .from('lead_scores')
          .select('contact_id, score, band')
          .eq('organization_id', org.id)
          .in('band', ['warm', 'hot'])
          .order('computed_at', { ascending: false })
          .limit(100);

        // Deduplicate: pick latest score per contact
        const seenContacts = new Set<string>();
        const leadsToEvaluate = (warmLeads ?? []).filter((l: { contact_id: string; score: number; band: string }) => {
          if (seenContacts.has(l.contact_id)) return false;
          seenContacts.add(l.contact_id);
          return !recentlyEvaluatedIds.has(l.contact_id);
        }).slice(0, 50);

        logger.info(`[SalesCron] Org ${org.id}: ${leadsToEvaluate.length} leads to re-evaluate`);

        const salesAgent = new SalesAgent();
        let count = 0;

        for (const lead of leadsToEvaluate) {
          try {
            await salesAgent.run({
              contactId: lead.contact_id,
              organizationId: org.id,
              // No conversationId or incomingMessage — pure background evaluation
            });
            count++;
          } catch (err: any) {
            logger.warn(`[SalesCron] Failed to evaluate contact ${lead.contact_id}:`, err.message);
          }
        }

        return count;
      });

      totalEvaluated += evaluated;
    }

    logger.info(`[SalesCron] Completed. Total contacts evaluated: ${totalEvaluated}`);
    return { evaluated: totalEvaluated };
  }
);
