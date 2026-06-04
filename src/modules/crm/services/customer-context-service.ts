// src/modules/crm/services/customer-context-service.ts

import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../workflows/services/admin-client';

let _salesPortalDbClient: SupabaseClient | null = null;

function getSalesPortalDbClient(): SupabaseClient {
  if (!_salesPortalDbClient) {
    const url = process.env.SALES_PORTAL_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SALES_PORTAL_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Sales Portal Supabase credentials are missing in environment variables.');
    }
    _salesPortalDbClient = createClient(url, key);
  }
  return _salesPortalDbClient;
}

// ============================================================
// Schemas
// ============================================================

export const CustomerProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});

export const LeadInfoSchema = z.object({
  leadId: z.string(),
  status: z.string(), // 'new' | 'contacted' | 'qualified' | 'converted'
  source: z.string().nullable().optional(),
  budget: z.number().nullable().optional(),
  requirements: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const ConversionStatusSchema = z.object({
  isConverted: z.boolean(),
  convertedAt: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
});

export const ProposalSummarySchema = z.object({
  proposalId: z.string().nullable().optional(),
  systemSizeKw: z.number().nullable().optional(),
  totalAmount: z.number().nullable().optional(),
  quoteStatus: z.string().nullable().optional(), // 'draft' | 'sent' | 'accepted' | 'rejected'
  createdAt: z.string().nullable().optional(),
});

export const ProjectStatusSchema = z.object({
  projectId: z.string().nullable().optional(),
  status: z.string().nullable().optional(), // 'design' | 'permit' | 'installing' | 'completed'
  progressPercentage: z.number().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});

export const InstallationScheduleSchema = z.object({
  slotId: z.string().nullable().optional(),
  scheduledAt: z.string().nullable().optional(),
  installerName: z.string().nullable().optional(),
  status: z.string().nullable().optional(), // 'scheduled' | 'completed' | 'cancelled'
});

export const FollowupSchema = z.object({
  followupId: z.string(),
  scheduledAt: z.string(),
  notes: z.string().nullable().optional(),
  status: z.string(), // 'pending' | 'completed'
});

export const CustomerDocumentSchema = z.object({
  documentId: z.string(),
  name: z.string(),
  type: z.string(), // 'id_proof' | 'electricity_bill' | 'roof_layout' | 'warranty'
  url: z.string(),
  uploadedAt: z.string(),
});

export const CustomerContextSchema = z.object({
  profile: CustomerProfileSchema,
  lead: LeadInfoSchema.nullable().optional(),
  conversion: ConversionStatusSchema,
  proposal: ProposalSummarySchema.nullable().optional(),
  project: ProjectStatusSchema.nullable().optional(),
  installation: InstallationScheduleSchema.nullable().optional(),
  followups: z.array(FollowupSchema),
  documents: z.array(CustomerDocumentSchema),
});

export type CustomerContext = z.infer<typeof CustomerContextSchema>;

// ============================================================
// Service
// ============================================================

export interface ServiceConfig {
  apiUrl?: string;
  apiKey?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export class CustomerContextService {
  private cache = new Map<string, { data: CustomerContext; expiresAt: number }>();
  private apiUrl: string;
  private apiKey: string;
  private cacheTtlMs: number;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config: ServiceConfig = {}) {
    this.apiUrl = config.apiUrl || process.env.SALES_PORTAL_API_URL || (process.env.SALES_PORTAL_SUPABASE_URL ? 'database' : 'mock');
    this.apiKey = config.apiKey || process.env.SALES_PORTAL_API_KEY || '';
    this.cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1000; // 5 min default
    this.timeoutMs = config.timeoutMs ?? 5000; // 5s timeout default
    this.maxRetries = config.maxRetries ?? 3;
  }

  /**
   * Fetches unified customer context by phone number.
   */
  async getCustomerContext(phoneNumber: string): Promise<CustomerContext> {
    const cacheKey = `phone:${phoneNumber}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    let data: CustomerContext;
    if (this.apiUrl === 'database') {
      try {
        data = await this.getContextFromDatabase('phone', phoneNumber);
      } catch (err: any) {
        console.warn(`[CustomerContextService] Remote lookup failed for phone ${phoneNumber}. Returning default context.`, err.message || err);
        data = this.createDefaultContext(phoneNumber, '');
      }
    } else {
      data = await this.fetchWithRetryAndTimeout(
        `${this.apiUrl}/api/v1/customer-context?phone=${encodeURIComponent(phoneNumber)}`
      );
    }

    this.setInCache(cacheKey, data);
    return data;
  }

  /**
   * Fetches unified customer context by lead ID.
   */
  async getCustomerContextByLeadId(leadId: string): Promise<CustomerContext> {
    const cacheKey = `lead:${leadId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    let data: CustomerContext;
    if (this.apiUrl === 'database') {
      try {
        data = await this.getContextFromDatabase('lead', leadId);
      } catch (err: any) {
        console.warn(`[CustomerContextService] Remote lookup failed for lead ${leadId}. Returning default context.`, err.message || err);
        data = this.createDefaultContext('', '');
      }
    } else {
      data = await this.fetchWithRetryAndTimeout(
        `${this.apiUrl}/api/v1/customer-context/lead/${encodeURIComponent(leadId)}`
      );
    }

    this.setInCache(cacheKey, data);
    return data;
  }

  /**
   * Fetches unified customer context by contact ID.
   */
  async getCustomerContextByContactId(contactId: string): Promise<CustomerContext> {
    const cacheKey = `contact:${contactId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    let data: CustomerContext;
    if (this.apiUrl === 'database') {
      // Look up phone number of contact from the local CRM database
      const admin = supabaseAdmin();
      const { data: contact } = await admin
        .from('contacts')
        .select('phone, name')
        .eq('id', contactId)
        .maybeSingle();

      if (contact?.phone) {
        try {
          data = await this.getContextFromDatabase('phone', contact.phone);
        } catch (err: any) {
          console.warn(`[CustomerContextService] Failed to query remote context by phone ${contact.phone}, falling back to contact ID lookup:`, err.message || err);
          try {
            data = await this.getContextFromDatabase('contact', contactId);
          } catch (fallbackErr: any) {
            console.warn(`[CustomerContextService] Failed remote lookup by contact ID as well. Returning default context.`, fallbackErr.message || fallbackErr);
            data = this.createDefaultContext(contact.phone, contact.name || '');
          }
        }
      } else {
        try {
          data = await this.getContextFromDatabase('contact', contactId);
        } catch (fallbackErr: any) {
          console.warn(`[CustomerContextService] Failed remote lookup by contact ID. Returning default context.`, fallbackErr.message || fallbackErr);
          data = this.createDefaultContext('', '');
        }
      }
    } else {
      data = await this.fetchWithRetryAndTimeout(
        `${this.apiUrl}/api/v1/customer-context/contact/${encodeURIComponent(contactId)}`
      );
    }

    this.setInCache(cacheKey, data);
    return data;
  }

  /**
   * Clears the in-memory cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private createDefaultContext(phone: string, name: string): CustomerContext {
    return {
      profile: {
        id: 'new-profile',
        name: name || 'New Customer',
        phone: phone || '',
        email: null,
        company: null,
        address: null,
      },
      lead: null,
      conversion: {
        isConverted: false,
        convertedAt: null,
        dealId: null,
      },
      proposal: null,
      project: null,
      installation: null,
      followups: [],
      documents: [],
    };
  }

  private getFromCache(key: string): CustomerContext | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  private setInCache(key: string, data: CustomerContext): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  private async fetchWithRetryAndTimeout(url: string): Promise<CustomerContext> {
    // If API URL is not set or mock fallback is triggered, return mocked context
    if (this.apiUrl === 'mock' || this.apiUrl.startsWith('mock')) {
      return this.generateMockContext(url);
    }

    let attempt = 0;
    let lastError: any = null;

    while (attempt < this.maxRetries) {
      attempt++;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'X-API-Key': this.apiKey,
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });

        clearTimeout(id);

        if (!response.ok) {
          throw new Error(`API error: HTTP ${response.status} ${response.statusText}`);
        }

        const json = await response.json();
        
        // Validation Layer
        const parsed = CustomerContextSchema.parse(json);
        return parsed;

      } catch (err: any) {
        clearTimeout(id);
        lastError = err;
        
        if (err.name === 'AbortError') {
          console.warn(`[CustomerContextService] Timeout reached on attempt ${attempt}`);
        } else {
          console.warn(`[CustomerContextService] Attempt ${attempt} failed: ${err.message}`);
        }

        if (attempt >= this.maxRetries) {
          break;
        }

        // Exponential backoff delay
        const delay = Math.pow(2, attempt) * 200;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error(`Failed to retrieve customer context from Sales Portal: ${lastError?.message || 'Unknown error'}`);
  }

  private generateMockContext(url: string): CustomerContext {
    // Simple parser to extract query params or path for mock content
    const isLeadId = url.includes('/lead/');
    const isContactId = url.includes('/contact/');
    let term = 'unknown';

    if (isLeadId) {
      term = url.split('/lead/')[1]?.split('?')[0] || 'unknown';
    } else if (isContactId) {
      term = url.split('/contact/')[1]?.split('?')[0] || 'unknown';
    } else {
      const match = url.match(/[?&]phone=([^&]+)/);
      if (match) {
        term = decodeURIComponent(match[1]);
      }
    }

    // Note: This mock path is only reached when SALES_PORTAL_API_URL is not set.
    // In production, configure SALES_PORTAL_API_URL or SALES_PORTAL_SUPABASE_URL.
    return {
      profile: {
        id: isContactId ? term : 'sample-contact-id',
        name: 'Sample Customer',
        phone: isContactId ? '+910000000000' : term,
        email: null,
        company: null,
        address: null,
      },
      lead: {
        leadId: isLeadId ? term : 'sample-lead-id',
        status: 'qualified',
        source: null,
        budget: null,
        requirements: null,
        createdAt: new Date().toISOString(),
      },
      conversion: {
        isConverted: false,
        convertedAt: null,
        dealId: null,
      },
      proposal: null,
      project: null,
      installation: null,
      followups: [],
      documents: [],
    };
  }

  private async getContextFromDatabase(lookupType: 'phone' | 'lead' | 'contact', value: string): Promise<CustomerContext> {
    const db = getSalesPortalDbClient();
    
    // 1. Fetch lead
    let leadRow: any = null;
    if (lookupType === 'phone') {
      const { data, error } = await db
        .from('leads')
        .select('*')
        .eq('whatsapp_number', value)
        .maybeSingle();
      if (error) throw new Error(`DB error fetching lead by phone: ${error.message}`);
      leadRow = data;
    } else {
      const { data, error } = await db
        .from('leads')
        .select('*')
        .eq('id', value)
        .maybeSingle();
      if (error) throw new Error(`DB error fetching lead by id: ${error.message}`);
      leadRow = data;
    }

    if (!leadRow) {
      throw new Error(`Customer/Lead not found for ${lookupType}: ${value}`);
    }

    const leadId = leadRow.id;

    // 2. Fetch converted_leads status
    const { data: convertedRow, error: convertedError } = await db
      .from('converted_leads')
      .select('*')
      .eq('lead_id', leadId)
      .maybeSingle();
    if (convertedError) console.error('Error fetching converted_leads:', convertedError.message);

    // 3. Fetch proposal
    const { data: proposalRow, error: proposalError } = await db
      .from('proposal')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (proposalError) console.error('Error fetching proposal:', proposalError.message);

    // 4. Fetch project progress
    const { data: progressRow, error: progressError } = await db
      .from('project_progress')
      .select('*')
      .eq('lead_id', leadId)
      .maybeSingle();
    if (progressError) console.error('Error fetching project_progress:', progressError.message);

    // 5. Fetch installation slot
    const { data: slotRow, error: slotError } = await db
      .from('installation_slots')
      .select('*')
      .eq('project_id', leadId)
      .order('confirmed_slot_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (slotError) console.error('Error fetching installation_slots:', slotError.message);

    // 6. Fetch follow-ups
    const { data: followupRows, error: followupsError } = await db
      .from('lead_follow_ups')
      .select('*')
      .eq('lead_id', leadId)
      .order('follow_up_at', { ascending: false });
    if (followupsError) console.error('Error fetching lead_follow_ups:', followupsError.message);

    // 7. Fetch documents
    const { data: documentRows, error: documentsError } = await db
      .from('customer_documents')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });
    if (documentsError) console.error('Error fetching customer_documents:', documentsError.message);

    // 8. Map to CustomerContext shape
    const profile = {
      id: leadRow.id,
      name: leadRow.customer_name || 'Unknown',
      phone: leadRow.whatsapp_number || '',
      email: leadRow.email || null,
      company: leadRow.salesperson_name || null,
      address: leadRow.address || null,
    };

    const lead = {
      leadId: leadRow.id,
      status: leadRow.status || 'new',
      source: leadRow.lead_source || null,
      budget: leadRow.project_cost ? Number(leadRow.project_cost) : null,
      requirements: leadRow.system_type || null,
      createdAt: leadRow.created_at || new Date().toISOString(),
    };

    const conversion = {
      isConverted: !!convertedRow,
      convertedAt: convertedRow?.converted_at || null,
      dealId: convertedRow?.id || null,
    };

    const proposal = proposalRow ? {
      proposalId: proposalRow.id,
      systemSizeKw: proposalRow.system_capacity ? Number(proposalRow.system_capacity) : null,
      totalAmount: proposalRow.amount ? Number(proposalRow.amount) : null,
      quoteStatus: proposalRow.estimate_number ? 'sent' : 'draft',
      createdAt: proposalRow.created_at || null,
    } : null;

    const project = progressRow ? {
      projectId: progressRow.id,
      status: progressRow.project_completed ? 'completed' : 'installing',
      progressPercentage: progressRow.project_completed ? 100 : 35,
      updatedAt: progressRow.updated_at || null,
    } : null;

    const installation = slotRow ? {
      slotId: slotRow.id,
      scheduledAt: slotRow.confirmed_slot_date ? new Date(slotRow.confirmed_slot_date).toISOString() : null,
      installerName: slotRow.hq_team_member_id || null,
      status: slotRow.status || null,
    } : null;

    const followups = (followupRows || []).map((row: any) => ({
      followupId: row.id,
      scheduledAt: row.follow_up_at || new Date().toISOString(),
      notes: row.notes || null,
      status: row.status || 'pending',
    }));

    const documents = (documentRows || []).map((row: any) => ({
      documentId: row.id,
      name: row.document_name,
      type: 'electricity_bill',
      url: row.drive_url || '',
      uploadedAt: row.created_at || new Date().toISOString(),
    }));

    return {
      profile,
      lead,
      conversion,
      proposal,
      project,
      installation,
      followups,
      documents,
    };
  }
}
export const customerContextService = new CustomerContextService();

