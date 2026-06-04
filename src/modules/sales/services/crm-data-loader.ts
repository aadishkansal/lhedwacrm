// src/modules/sales/services/crm-data-loader.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { MemoryRetriever } from '../../memory/services/memory-retriever';
import {
  CRMContact,
  CRMDeal,
  CRMProject,
  CRMQuote,
  LeadSignals,
  SalesContext,
  LeadScore,
} from '../types';

// Placeholder LeadScore — replaced by LeadScoringEngine before returning
const EMPTY_SCORE: LeadScore = { score: 0, band: 'cold', breakdown: {} };

export class CRMDataLoader {
  private memoryRetriever = new MemoryRetriever();

  /**
   * Loads the full CRM context for a contact and assembles a SalesContext.
   * LeadScore and signals are populated with defaults here and must be filled
   * by LeadScoringEngine before the context is passed to SalesAgent.
   */
  async loadContext(params: {
    contactId: string;
    organizationId: string;
    incomingMessage?: string;
    query?: string;
  }): Promise<SalesContext> {
    const admin = supabaseAdmin();
    const query = params.query || params.incomingMessage || 'sales context';

    // 1. Contact profile
    const { data: rawContact } = await admin
      .from('contacts')
      .select('id, name, phone, email, company, organization_id')
      .eq('id', params.contactId)
      .single();

    const contact: CRMContact = {
      id: rawContact?.id ?? params.contactId,
      name: rawContact?.name ?? undefined,
      phone: rawContact?.phone ?? '',
      email: rawContact?.email ?? undefined,
      company: rawContact?.company ?? undefined,
      organizationId: rawContact?.organization_id ?? params.organizationId,
    };

    // 2. Latest active deal (with pipeline stage name)
    const { data: dealRows } = await admin
      .from('deals')
      .select(`
        id, title, value, status, expected_close_date,
        pipeline_stages!stage_id(name)
      `)
      .eq('contact_id', params.contactId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1);

    const rawDeal = dealRows?.[0];
    const deal: CRMDeal | undefined = rawDeal
      ? {
          id: rawDeal.id,
          title: rawDeal.title,
          value: rawDeal.value ?? 0,
          stageName: (rawDeal as any).pipeline_stages?.name ?? 'unknown',
          status: rawDeal.status,
          expectedCloseDate: rawDeal.expected_close_date ?? undefined,
        }
      : undefined;

    // 3. Latest EPC project
    const { data: projectRows } = await admin
      .from('epc_projects')
      .select('id, status, system_size_kw, address')
      .eq('contact_id', params.contactId)
      .eq('organization_id', params.organizationId)
      .order('updated_at', { ascending: false })
      .limit(1);

    const rawProject = projectRows?.[0];
    const project: CRMProject | undefined = rawProject
      ? {
          id: rawProject.id,
          status: rawProject.status ?? 'lead',
          systemSizeKw: rawProject.system_size_kw ?? undefined,
          address: rawProject.address ?? undefined,
        }
      : undefined;

    // 4. Latest quotation for the project
    let quote: CRMQuote | undefined;
    if (project?.id) {
      const { data: quoteRows } = await admin
        .from('epc_quotes')
        .select('id, total_amount, status, pdf_url, created_at')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })
        .limit(1);

      const rawQuote = quoteRows?.[0];
      if (rawQuote) {
        quote = {
          id: rawQuote.id,
          totalAmount: rawQuote.total_amount,
          status: rawQuote.status ?? 'draft',
          pdfUrl: rawQuote.pdf_url ?? undefined,
          createdAt: rawQuote.created_at,
        };
      }
    }

    // 5. Conversation history (last 10 messages from newest conversation)
    const { data: convRows } = await admin
      .from('conversations')
      .select('id')
      .eq('contact_id', params.contactId)
      .order('updated_at', { ascending: false })
      .limit(1);

    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let messageCount = 0;
    let daysSinceLastContact = 999;

    if (convRows?.[0]?.id) {
      const convId = convRows[0].id;
      const { data: msgRows } = await admin
        .from('messages')
        .select('sender_type, content_text, created_at')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (msgRows && msgRows.length > 0) {
        messageCount = msgRows.length;
        // How many days since the most recent message?
        const latest = new Date(msgRows[0].created_at);
        daysSinceLastContact = Math.floor((Date.now() - latest.getTime()) / (1000 * 60 * 60 * 24));

        conversationHistory = msgRows
          .filter(m => m.sender_type === 'customer' || m.sender_type === 'bot' || m.sender_type === 'agent')
          .map(m => ({
            role: m.sender_type === 'customer' ? 'user' as const : 'assistant' as const,
            content: m.content_text || '',
          }))
          .reverse();
      }
    }

    // 6. Customer memory (pgvector RAG)
    const { facts, preferences, interactions } = await this.memoryRetriever
      .retrieveMemories({
        contactId: params.contactId,
        organizationId: params.organizationId,
        query,
      })
      .catch(() => ({ facts: [], preferences: [], interactions: [] }));

    const memoryContext = await this.memoryRetriever
      .retrieveContext({ contactId: params.contactId, organizationId: params.organizationId, query })
      .catch(() => '');

    // 7. Check if there's a scheduled site visit
    let hasScheduledVisit = false;
    if (project?.id) {
      const { data: visitRows } = await admin
        .from('epc_site_visits')
        .select('id')
        .eq('project_id', project.id)
        .eq('status', 'scheduled')
        .limit(1);
      hasScheduledVisit = (visitRows?.length ?? 0) > 0;
    }

    // 8. Derived: did the customer respond in last 24h?
    const responsed24h = daysSinceLastContact === 0;

    // 9. Assemble raw signals
    const signals: LeadSignals = {
      hasDeal: !!deal,
      dealValue: deal?.value ?? 0,
      daysSinceLastContact,
      messageCount,
      hasProject: !!project,
      projectStatus: project?.status ?? 'none',
      hasQuote: !!quote,
      quoteAmount: quote?.totalAmount ?? 0,
      quoteStatus: quote?.status ?? 'none',
      responsed24h,
      memoryFactCount: facts.length,
      hasScheduledVisit,
    };

    return {
      contact,
      deal,
      project,
      quote,
      conversationHistory,
      memoryContext,
      memoryFacts: facts,
      incomingMessage: params.incomingMessage,
      leadScore: EMPTY_SCORE, // filled in by LeadScoringEngine
      signals,
    };
  }
}
