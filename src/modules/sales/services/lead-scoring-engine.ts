// src/modules/sales/services/lead-scoring-engine.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { LeadSignals, LeadScore, LeadBand } from '../types';

/**
 * Weighted scoring rules.
 *
 * Each signal is mapped to a max point value. The engine sums points
 * and normalises to a 0-100 score. Band thresholds:
 *   cold  =  0 – 30
 *   warm  = 31 – 65
 *   hot   = 66 – 100
 */
const WEIGHTS = {
  // Deal presence / size
  hasDeal:            15,
  dealValue:          10,   // scaled: up to 10 pts for ≥ 500,000 INR (or equivalent)

  // Project / pipeline stage
  hasProject:         10,
  projectStatusScore: 15,   // scaled by stage progress

  // Quotation signals
  hasQuote:            8,
  quoteSent:           7,   // bonus if status is 'sent'
  quoteAccepted:       7,   // bonus if status is 'accepted'

  // Engagement
  responsed24h:       10,
  messageCount:        8,   // scaled: up to 8 pts for ≥ 20 messages
  memoryFactCount:     5,   // up to 5 pts for ≥ 5 memory facts

  // Site visit scheduled
  hasScheduledVisit:   5,

  // Recency penalty (negative contribution)
  staleness:         -10,   // full deduction if > 30 days since last contact
} as const;

// Stage → progress score (0–15)
const PROJECT_STAGE_SCORE: Record<string, number> = {
  none:           0,
  lead:           3,
  site_visit:     6,
  quoted:        10,
  in_progress:   13,
  completed:     15,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreToBand(score: number): LeadBand {
  if (score >= 66) return 'hot';
  if (score >= 31) return 'warm';
  return 'cold';
}

export class LeadScoringEngine {

  /**
   * Compute a structured LeadScore from raw signals.
   * Pure calculation — no I/O.
   */
  compute(signals: LeadSignals): LeadScore {
    const breakdown: Record<string, number> = {};

    // --- Deal signals ---
    breakdown.hasDeal = signals.hasDeal ? WEIGHTS.hasDeal : 0;

    // Deal value: scale 0–10 for 0 – 500,000 INR
    const dealValuePts = signals.hasDeal
      ? clamp(Math.round((signals.dealValue / 500_000) * WEIGHTS.dealValue), 0, WEIGHTS.dealValue)
      : 0;
    breakdown.dealValue = dealValuePts;

    // --- Project signals ---
    breakdown.hasProject = signals.hasProject ? WEIGHTS.hasProject : 0;
    breakdown.projectStatusScore = PROJECT_STAGE_SCORE[signals.projectStatus] ?? 0;

    // --- Quote signals ---
    breakdown.hasQuote = signals.hasQuote ? WEIGHTS.hasQuote : 0;
    breakdown.quoteSent = signals.quoteStatus === 'sent' ? WEIGHTS.quoteSent : 0;
    breakdown.quoteAccepted = signals.quoteStatus === 'accepted' ? WEIGHTS.quoteAccepted : 0;

    // --- Engagement signals ---
    breakdown.responsed24h = signals.responsed24h ? WEIGHTS.responsed24h : 0;

    // Message count: scale 0–8 for 0–20 messages
    const msgPts = clamp(Math.round((signals.messageCount / 20) * WEIGHTS.messageCount), 0, WEIGHTS.messageCount);
    breakdown.messageCount = msgPts;

    // Memory facts: scale 0–5 for 0–5 facts
    const memPts = clamp(Math.round((signals.memoryFactCount / 5) * WEIGHTS.memoryFactCount), 0, WEIGHTS.memoryFactCount);
    breakdown.memoryFactCount = memPts;

    // Site visit scheduled
    breakdown.hasScheduledVisit = signals.hasScheduledVisit ? WEIGHTS.hasScheduledVisit : 0;

    // --- Recency penalty ---
    // Full penalty (-10) if no contact for > 30 days; partial for 8–30 days
    let stalenessPts = 0;
    if (signals.daysSinceLastContact > 30) {
      stalenessPts = WEIGHTS.staleness;
    } else if (signals.daysSinceLastContact > 7) {
      stalenessPts = Math.round((signals.daysSinceLastContact / 30) * WEIGHTS.staleness);
    }
    breakdown.staleness = stalenessPts;

    // --- Total ---
    const rawTotal = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
    const maxPossible = WEIGHTS.hasDeal + WEIGHTS.dealValue + WEIGHTS.hasProject +
      15 /* projectStatusScore max */ + WEIGHTS.hasQuote + WEIGHTS.quoteSent +
      WEIGHTS.quoteAccepted + WEIGHTS.responsed24h + WEIGHTS.messageCount +
      WEIGHTS.memoryFactCount + WEIGHTS.hasScheduledVisit;

    const score = clamp(Math.round((rawTotal / maxPossible) * 100), 0, 100);
    const band = scoreToBand(score);

    return { score, band, breakdown };
  }

  /**
   * Compute and persist lead score to the `lead_scores` table.
   */
  async scoreAndPersist(params: {
    contactId: string;
    organizationId: string;
    signals: LeadSignals;
  }): Promise<LeadScore> {
    const leadScore = this.compute(params.signals);

    const admin = supabaseAdmin();
    const { error } = await admin.from('lead_scores').insert({
      contact_id: params.contactId,
      organization_id: params.organizationId,
      score: leadScore.score,
      band: leadScore.band,
      signals: params.signals as unknown as Record<string, unknown>,
    });

    if (error) {
      console.error('[LeadScoringEngine] Failed to persist lead score:', error.message);
    }

    return leadScore;
  }

  /**
   * Retrieve the most recent persisted lead score for a contact.
   */
  async getLatestScore(params: { contactId: string; organizationId: string }): Promise<LeadScore | null> {
    const admin = supabaseAdmin();
    const { data } = await admin
      .from('lead_scores')
      .select('score, band, signals')
      .eq('contact_id', params.contactId)
      .eq('organization_id', params.organizationId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    return {
      score: data.score,
      band: data.band as LeadBand,
      breakdown: {},
    };
  }
}
