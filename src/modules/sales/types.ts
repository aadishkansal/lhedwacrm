// src/modules/sales/types.ts

// -----------------------------------------------------------------------
// Lead Scoring
// -----------------------------------------------------------------------

export type LeadBand = 'cold' | 'warm' | 'hot';

export interface LeadSignals {
  // Deal / pipeline signals
  hasDeal: boolean;
  dealValue: number;           // INR / USD
  daysSinceLastContact: number;
  messageCount: number;        // total conversation messages

  // Project signals
  hasProject: boolean;
  projectStatus: string;       // 'lead' | 'site_visit' | 'quoted' | 'in_progress' | 'completed'
  hasQuote: boolean;
  quoteAmount: number;
  quoteStatus: string;         // 'draft' | 'sent' | 'accepted' | 'rejected'

  // Engagement signals
  responsed24h: boolean;       // did they respond within last 24h?
  memoryFactCount: number;     // how many long-term facts do we have?
  hasScheduledVisit: boolean;
}

export interface LeadScore {
  score: number;               // 0–100
  band: LeadBand;              // 'cold' | 'warm' | 'hot'
  breakdown: Record<string, number>; // per-signal contribution
}

// -----------------------------------------------------------------------
// Sales Context
// -----------------------------------------------------------------------

export interface CRMContact {
  id: string;
  name?: string;
  phone: string;
  email?: string;
  company?: string;
  organizationId: string;
}

export interface CRMDeal {
  id: string;
  title: string;
  value: number;
  stageName: string;
  status: string;
  expectedCloseDate?: string;
}

export interface CRMProject {
  id: string;
  status: string;
  systemSizeKw?: number;
  address?: string;
}

export interface CRMQuote {
  id: string;
  totalAmount: number;
  status: string;
  pdfUrl?: string;
  createdAt: string;
}

export interface SalesContext {
  contact: CRMContact;
  deal?: CRMDeal;
  project?: CRMProject;
  quote?: CRMQuote;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  memoryContext: string;       // formatted string from MemoryRetriever
  memoryFacts: string[];
  incomingMessage?: string;    // the triggering message (if WhatsApp triggered)
  leadScore: LeadScore;
  signals: LeadSignals;
  leadIntelligence?: LeadIntelligenceInsights;
}

// -----------------------------------------------------------------------
// Sales Agent Decision
// -----------------------------------------------------------------------

export type SalesAction =
  | 'SEND_FOLLOWUP'
  | 'EXPLAIN_QUOTATION'
  | 'RECOMMEND_PRODUCT'
  | 'BOOK_APPOINTMENT'
  | 'QUALIFY_LEAD'
  | 'ESCALATE_TO_HUMAN'
  | 'NO_ACTION';

export interface SalesDecision {
  action: SalesAction;
  reasoning: string;
  followupMessage?: string;    // for SEND_FOLLOWUP / EXPLAIN_QUOTATION / RECOMMEND_PRODUCT
  appointmentType?: string;    // for BOOK_APPOINTMENT
  appointmentNotes?: string;
  productRecommendation?: {
    systemSizeKw: number;
    panelType: string;
    inverterType: string;
    estimatedCost: number;
    reasoning: string;
  };
  urgency: 'low' | 'medium' | 'high';
}

// -----------------------------------------------------------------------
// Followup Message
// -----------------------------------------------------------------------

export type FollowupTemplate =
  | 'lead_nurture'
  | 'quotation_followup'
  | 'site_visit_reminder'
  | 'appointment_confirmation'
  | 'product_recommendation'
  | 'win_back';

export interface FollowupMessage {
  text: string;
  template: FollowupTemplate;
}

// -----------------------------------------------------------------------
// Lead Intelligence
// -----------------------------------------------------------------------

export interface LeadFollowUp {
  id: string;
  organizationId: string;
  contactId: string;
  status: 'pending' | 'completed' | 'cancelled';
  notes?: string;
  scheduledAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadStageHistory {
  id: string;
  organizationId: string;
  contactId: string;
  dealId?: string;
  stageName: string;
  enteredAt: string;
  exitedAt?: string;
  durationDays?: number;
  createdAt: string;
}

export interface LeadLostReason {
  id: string;
  organizationId: string;
  contactId: string;
  dealId?: string;
  reason: string;
  details?: string;
  lostAt: string;
  createdAt: string;
}

export interface Proposal {
  id: string;
  organizationId: string;
  contactId: string;
  dealId?: string;
  title: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConvertedLead {
  id: string;
  organizationId: string;
  contactId: string;
  dealId?: string;
  convertedAt: string;
  value?: number;
  createdAt: string;
}

export interface LeadIntelligenceInsights {
  id: string;
  organizationId: string;
  contactId: string;
  score: number;
  conversionProbability: number; // 0.0 - 100.0
  likelyObjections: string[];
  churnRisk: number; // 0.0 - 100.0
  nextBestAction: string;
  followupSuggestions: Array<{
    type: string;
    description: string;
    recommendedTime?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}
