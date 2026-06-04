// src/modules/crm/services/sales-portal-connector.ts

import { z } from 'zod';
import { randomUUID } from 'crypto';
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
// Endpoint Response Schemas
// ============================================================

export const CustomerSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string(),
  email: z.string().email().nullable().optional(),
  company: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const LeadSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  status: z.string(), // 'new' | 'contacted' | 'qualified' | 'converted'
  source: z.string().nullable().optional(),
  budget: z.number().nullable().optional(),
  requirements: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const ProposalSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  systemSizeKw: z.number(),
  totalAmount: z.number(),
  status: z.string(), // 'draft' | 'sent' | 'accepted' | 'rejected'
  pdfUrl: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const ProjectProgressSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  status: z.string(), // 'design' | 'permit' | 'installing' | 'completed'
  progressPercentage: z.number(),
  systemSizeKw: z.number().nullable().optional(),
  address: z.string().nullable().optional(),
  updatedAt: z.string(),
});

export const InstallationSchema = z.object({
  slotId: z.string().uuid(),
  projectId: z.string().uuid(),
  scheduledAt: z.string(),
  installerName: z.string().nullable().optional(),
  status: z.string(), // 'scheduled' | 'completed' | 'cancelled'
  netMeteringStatus: z.string().nullable().optional(), // 'applied' | 'approved' | 'connected'
});

export const FollowupSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  scheduledAt: z.string(),
  type: z.string(), // 'site_visit' | 'sales_call' | 'installation_review' | 'followup_call'
  notes: z.string().nullable().optional(),
  status: z.string(), // 'pending' | 'completed'
});

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  name: z.string(),
  type: z.string(), // 'id_proof' | 'electricity_bill' | 'roof_layout' | 'warranty'
  url: z.string(),
  uploadedAt: z.string(),
});

export const InvoiceSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  amount: z.number(),
  status: z.string(), // 'paid' | 'pending' | 'overdue'
  dueDate: z.string(),
  createdAt: z.string(),
});

export const SupportTicketSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  title: z.string(),
  priority: z.string(), // 'low' | 'medium' | 'high'
  status: z.string(), // 'open' | 'closed'
  createdAt: z.string(),
});

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  assignedAgentId: z.string().uuid().nullable().optional(),
  status: z.string(), // 'open' | 'snoozed' | 'closed'
  updatedAt: z.string(),
});

// ============================================================
// Service Configuration
// ============================================================

export interface ConnectorConfig {
  apiUrl?: string;
  apiKey?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export class SalesPortalConnector {
  private cache = new Map<string, { data: any; expiresAt: number }>();
  private apiUrl: string;
  private apiKey: string;
  private cacheTtlMs: number;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config: ConnectorConfig = {}) {
    this.apiUrl = config.apiUrl || process.env.SALES_PORTAL_API_URL || (process.env.SALES_PORTAL_SUPABASE_URL ? 'database' : 'mock');
    this.apiKey = config.apiKey || process.env.SALES_PORTAL_API_KEY || '';
    this.cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1000; // 5 min TTL
    this.timeoutMs = config.timeoutMs ?? 5000; // 5s timeout
    this.maxRetries = config.maxRetries ?? 3;
  }

  /**
   * Resolves a local CRM contact ID to the remote lead ID using the contact's phone number.
   * If local lookup fails or contact does not exist, returns the original contactId.
   */
  private async resolveRemoteLeadId(contactId: string): Promise<string> {
    try {
      const admin = supabaseAdmin();
      const { data: contact } = await admin
        .from('contacts')
        .select('phone')
        .eq('id', contactId)
        .maybeSingle();

      if (!contact?.phone) {
        return contactId;
      }

      const db = getSalesPortalDbClient();
      const { data: lead, error } = await db
        .from('leads')
        .select('id')
        .eq('whatsapp_number', contact.phone)
        .maybeSingle();

      if (error || !lead) {
        return contactId;
      }

      return lead.id;
    } catch {
      return contactId;
    }
  }

  // ============================================================
  // Endpoints (GET)
  // ============================================================

  async getCustomer(phone: string): Promise<z.infer<typeof CustomerSchema>> {
    if (this.apiUrl === 'database') {
      const db = getSalesPortalDbClient();
      const { data, error } = await db
        .from('leads')
        .select('id, customer_name, whatsapp_number, email, address, created_at')
        .eq('whatsapp_number', phone)
        .maybeSingle();
      if (error) throw new Error(`Database error in getCustomer: ${error.message}`);
      if (!data) throw new Error(`Customer with phone ${phone} not found`);
      return {
        id: data.id,
        name: data.customer_name || 'Unknown',
        phone: data.whatsapp_number || phone,
        email: data.email || null,
        company: null,
        address: data.address || null,
        createdAt: data.created_at || new Date().toISOString()
      };
    }
    return this.get(`customer?phone=${encodeURIComponent(phone)}`, CustomerSchema);
  }

  async getCustomerById(contactId: string): Promise<z.infer<typeof CustomerSchema>> {
    if (this.apiUrl === 'database') {
      const db = getSalesPortalDbClient();
      const resolvedId = await this.resolveRemoteLeadId(contactId);
      const { data, error } = await db
        .from('leads')
        .select('id, customer_name, whatsapp_number, email, address, created_at')
        .eq('id', resolvedId)
        .maybeSingle();
      if (error) throw new Error(`Database error in getCustomerById: ${error.message}`);
      if (!data) throw new Error(`Customer with ID ${contactId} not found`);
      return {
        id: data.id,
        name: data.customer_name || 'Unknown',
        phone: data.whatsapp_number || '',
        email: data.email || null,
        company: null,
        address: data.address || null,
        createdAt: data.created_at || new Date().toISOString()
      };
    }
    return this.get(`customer/${contactId}`, CustomerSchema);
  }

  async getLead(leadId: string): Promise<z.infer<typeof LeadSchema>> {
    if (this.apiUrl === 'database') {
      const db = getSalesPortalDbClient();
      const { data, error } = await db
        .from('leads')
        .select('id, status, lead_source, project_cost, system_type, created_at')
        .eq('id', leadId)
        .maybeSingle();
      if (error) throw new Error(`Database error in getLead: ${error.message}`);
      if (!data) throw new Error(`Lead with ID ${leadId} not found`);
      return {
        id: data.id,
        contactId: data.id,
        status: data.status || 'new',
        source: data.lead_source || null,
        budget: data.project_cost ? Number(data.project_cost) : null,
        requirements: data.system_type || null,
        createdAt: data.created_at || new Date().toISOString()
      };
    }
    return this.get(`lead/${leadId}`, LeadSchema);
  }

  async getProposal(proposalId: string): Promise<z.infer<typeof ProposalSchema>> {
    if (this.apiUrl === 'database') {
      const db = getSalesPortalDbClient();
      const { data, error } = await db
        .from('proposal')
        .select('id, lead_id, system_capacity, amount, pdf_url, created_at')
        .eq('id', proposalId)
        .maybeSingle();
      if (error) throw new Error(`Database error in getProposal: ${error.message}`);
      if (!data) throw new Error(`Proposal with ID ${proposalId} not found`);
      return {
        id: data.id,
        projectId: data.lead_id,
        systemSizeKw: data.system_capacity ? Number(data.system_capacity) : 0,
        totalAmount: data.amount ? Number(data.amount) : 0,
        status: 'sent',
        pdfUrl: data.pdf_url || null,
        createdAt: data.created_at || new Date().toISOString()
      };
    }
    return this.get(`proposal/${proposalId}`, ProposalSchema);
  }

  async getProposalsByProject(projectId: string): Promise<z.infer<typeof ProposalSchema>[]> {
    if (this.apiUrl === 'database') {
      const db = getSalesPortalDbClient();
      const resolvedId = await this.resolveRemoteLeadId(projectId);
      const { data, error } = await db
        .from('proposal')
        .select('id, lead_id, system_capacity, amount, pdf_url, created_at')
        .eq('lead_id', resolvedId);
      if (error) throw new Error(`Database error in getProposalsByProject: ${error.message}`);
      return (data || []).map(row => ({
        id: row.id,
        projectId: row.lead_id,
        systemSizeKw: row.system_capacity ? Number(row.system_capacity) : 0,
        totalAmount: row.amount ? Number(row.amount) : 0,
        status: 'sent',
        pdfUrl: row.pdf_url || null,
        createdAt: row.created_at || new Date().toISOString()
      }));
    }
    return this.get(`proposals?projectId=${projectId}`, z.array(ProposalSchema));
  }

  async getProjectProgress(projectId: string): Promise<z.infer<typeof ProjectProgressSchema>> {
    if (this.apiUrl === 'database') {
      const db = getSalesPortalDbClient();
      let { data, error } = await db
        .from('project_progress')
        .select('id, lead_id, project_completed, updated_at')
        .eq('id', projectId)
        .maybeSingle();
      if (!data && !error) {
        // Try querying by lead_id
        const resolvedId = await this.resolveRemoteLeadId(projectId);
        const res = await db
          .from('project_progress')
          .select('id, lead_id, project_completed, updated_at')
          .eq('lead_id', resolvedId)
          .maybeSingle();
        data = res.data;
        error = res.error;
      }
      if (error) throw new Error(`Database error in getProjectProgress: ${error.message}`);
      if (!data) throw new Error(`Project progress with ID ${projectId} not found`);
      return {
        id: data.id,
        contactId: data.lead_id,
        status: data.project_completed ? 'completed' : 'installing',
        progressPercentage: data.project_completed ? 100 : 35,
        systemSizeKw: null,
        address: null,
        updatedAt: data.updated_at || new Date().toISOString()
      };
    }
    return this.get(`project/${projectId}`, ProjectProgressSchema);
  }

  async getProjectProgressByContact(contactId: string): Promise<z.infer<typeof ProjectProgressSchema>[]> {
    if (this.apiUrl === 'database') {
      const db = getSalesPortalDbClient();
      const resolvedId = await this.resolveRemoteLeadId(contactId);
      const { data, error } = await db
        .from('project_progress')
        .select('id, lead_id, project_completed, updated_at')
        .eq('lead_id', resolvedId);
      if (error) throw new Error(`Database error in getProjectProgressByContact: ${error.message}`);
      return (data || []).map(row => ({
        id: row.id,
        contactId: row.lead_id,
        status: row.project_completed ? 'completed' : 'installing',
        progressPercentage: row.project_completed ? 100 : 35,
        systemSizeKw: null,
        address: null,
        updatedAt: row.updated_at || new Date().toISOString()
      }));
    }
    return this.get(`projects?contactId=${contactId}`, z.array(ProjectProgressSchema));
  }

  async getInstallation(slotId: string): Promise<z.infer<typeof InstallationSchema>> {
    if (this.apiUrl === 'database') {
      const db = getSalesPortalDbClient();
      const { data, error } = await db
        .from('installation_slots')
        .select('id, project_id, confirmed_slot_date, hq_team_member_id, status')
        .eq('id', slotId)
        .maybeSingle();
      if (error) throw new Error(`Database error in getInstallation: ${error.message}`);
      if (!data) throw new Error(`Installation slot with ID ${slotId} not found`);
      return {
        slotId: data.id,
        projectId: data.project_id,
        scheduledAt: data.confirmed_slot_date ? new Date(data.confirmed_slot_date).toISOString() : new Date().toISOString(),
        installerName: data.hq_team_member_id || null,
        status: data.status || 'scheduled',
        netMeteringStatus: null
      };
    }
    return this.get(`installation/${slotId}`, InstallationSchema);
  }

  async getInstallationsByProject(projectId: string): Promise<z.infer<typeof InstallationSchema>[]> {
    if (this.apiUrl === 'database') {
      const db = getSalesPortalDbClient();
      const resolvedId = await this.resolveRemoteLeadId(projectId);
      const { data, error } = await db
        .from('installation_slots')
        .select('id, project_id, confirmed_slot_date, hq_team_member_id, status')
        .eq('project_id', resolvedId);
      if (error) throw new Error(`Database error in getInstallationsByProject: ${error.message}`);
      return (data || []).map(row => ({
        slotId: row.id,
        projectId: row.project_id,
        scheduledAt: row.confirmed_slot_date ? new Date(row.confirmed_slot_date).toISOString() : new Date().toISOString(),
        installerName: row.hq_team_member_id || null,
        status: row.status || 'scheduled',
        netMeteringStatus: null
      }));
    }
    return this.get(`installations?projectId=${projectId}`, z.array(InstallationSchema));
  }

  async getFollowups(contactId: string): Promise<z.infer<typeof FollowupSchema>[]> {
    if (this.apiUrl === 'database') {
      const db = getSalesPortalDbClient();
      const resolvedId = await this.resolveRemoteLeadId(contactId);
      const { data, error } = await db
        .from('lead_follow_ups')
        .select('id, lead_id, follow_up_at, purpose, notes, status')
        .eq('lead_id', resolvedId);
      if (error) throw new Error(`Database error in getFollowups: ${error.message}`);
      return (data || []).map(row => ({
        id: row.id,
        contactId: row.lead_id,
        scheduledAt: row.follow_up_at || new Date().toISOString(),
        type: row.purpose || 'followup_call',
        notes: row.notes || null,
        status: row.status || 'pending'
      }));
    }
    return this.get(`followups?contactId=${contactId}`, z.array(FollowupSchema));
  }

  async getDocuments(contactId: string): Promise<z.infer<typeof DocumentSchema>[]> {
    if (this.apiUrl === 'database') {
      const db = getSalesPortalDbClient();
      const resolvedId = await this.resolveRemoteLeadId(contactId);
      const { data, error } = await db
        .from('customer_documents')
        .select('id, lead_id, document_name, drive_url, created_at')
        .eq('lead_id', resolvedId);
      if (error) throw new Error(`Database error in getDocuments: ${error.message}`);
      return (data || []).map(row => ({
        id: row.id,
        contactId: row.lead_id,
        name: row.document_name,
        type: 'electricity_bill',
        url: row.drive_url || '',
        uploadedAt: row.created_at || new Date().toISOString()
      }));
    }
    return this.get(`documents?contactId=${contactId}`, z.array(DocumentSchema));
  }

  async getInvoice(invoiceId: string): Promise<z.infer<typeof InvoiceSchema>> {
    if (this.apiUrl === 'database') {
      return {
        id: invoiceId,
        contactId: randomUUID(),
        amount: 0,
        status: 'paid',
        dueDate: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
    }
    return this.get(`invoice/${invoiceId}`, InvoiceSchema);
  }

  async getInvoices(contactId: string): Promise<z.infer<typeof InvoiceSchema>[]> {
    if (this.apiUrl === 'database') {
      return [];
    }
    return this.get(`invoices?contactId=${contactId}`, z.array(InvoiceSchema));
  }

  // ============================================================
  // Mutations (POST/PATCH) - Bypasses Cache
  // ============================================================

  async createSupportTicket(params: {
    contactId: string;
    title: string;
    priority: string;
    status: string;
    organizationId?: string;
  }): Promise<z.infer<typeof SupportTicketSchema>> {
    if (this.apiUrl === 'database') {
      const db = supabaseAdmin();
      const orgId = params.organizationId || 'eaa4f7f0-7d7b-4d1f-a720-4b654e0c104c';
      const { data, error } = await db
        .from('support_tickets')
        .insert({
          organization_id: orgId,
          contact_id: params.contactId,
          title: params.title,
          priority: params.priority || 'medium',
          status: params.status || 'open'
        })
        .select('*')
        .single();
      if (error) throw new Error(`Database error in createSupportTicket: ${error.message}`);
      return {
        id: data.id,
        contactId: data.contact_id,
        title: data.title,
        priority: data.priority,
        status: data.status,
        createdAt: data.created_at
      };
    }
    return this.post('support-ticket', params, SupportTicketSchema);
  }

  async assignHumanAgent(params: {
    conversationId: string;
    agentId: string | null;
    status: string;
  }): Promise<z.infer<typeof ConversationSchema>> {
    if (this.apiUrl === 'database') {
      const db = supabaseAdmin();
      const { data, error } = await db
        .from('conversations')
        .update({
          assigned_agent_id: params.agentId,
          status: params.status || 'open',
          updated_at: new Date().toISOString()
        })
        .eq('id', params.conversationId)
        .select('*')
        .single();
      if (error) throw new Error(`Database error in assignHumanAgent: ${error.message}`);
      return {
        id: data.id,
        contactId: data.contact_id,
        assignedAgentId: data.assigned_agent_id,
        status: data.status,
        updatedAt: data.updated_at
      };
    }
    return this.post('conversation/assign', params, ConversationSchema);
  }

  // ============================================================
  // Caching Methods
  // ============================================================

  clearCache(): void {
    this.cache.clear();
  }

  // ============================================================
  // Generic Fetch Layer with Caching, Retries, and Timeouts
  // ============================================================

  private async get<T extends z.ZodTypeAny>(path: string, schema: T): Promise<z.infer<T>> {
    const cacheKey = `get:${path}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() <= cached.expiresAt) {
      return cached.data;
    }

    const data = await this.request('GET', path, null, schema);
    this.cache.set(cacheKey, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
    return data;
  }

  private async post<T extends z.ZodTypeAny>(path: string, body: any, schema: T): Promise<z.infer<T>> {
    return this.request('POST', path, body, schema);
  }

  private async request<T extends z.ZodTypeAny>(
    method: 'GET' | 'POST',
    path: string,
    body: any,
    schema: T
  ): Promise<z.infer<T>> {
    const url = `${this.apiUrl}/api/v1/${path}`;

    if (this.apiUrl === 'mock' || this.apiUrl.startsWith('mock')) {
      return this.generateMockResponse(method, path, body, schema);
    }

    let attempt = 0;
    let lastError: any = null;

    while (attempt < this.maxRetries) {
      attempt++;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(id);

        if (!response.ok) {
          throw new Error(`API error: HTTP ${response.status} ${response.statusText}`);
        }

        const json = await response.json();
        
        // Zod validation
        return schema.parse(json);

      } catch (err: any) {
        clearTimeout(id);
        lastError = err;
        console.warn(`[SalesPortalConnector] ${method} ${path} attempt ${attempt} failed: ${err.message}`);

        if (attempt >= this.maxRetries) {
          break;
        }

        const delay = Math.pow(2, attempt) * 200;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error(`Sales Portal Connector error: ${lastError?.message || 'Unknown error'}`);
  }

  // ============================================================
  // Mock fallback logic
  // ============================================================

  private generateMockResponse<T extends z.ZodTypeAny>(
    method: 'GET' | 'POST',
    path: string,
    body: any,
    schema: T
  ): z.infer<T> {
    const dummyContactId = 'c2125eaf-b7ba-432f-8fd0-6978f3277ac1';
    const dummyProjectId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

    if (method === 'POST') {
      if (path === 'support-ticket') {
        return schema.parse({
          id: randomUUID(),
          contactId: body.contactId || dummyContactId,
          title: body.title || 'Warranty Query',
          priority: body.priority || 'medium',
          status: body.status || 'open',
          createdAt: new Date().toISOString(),
        });
      }
      if (path === 'conversation/assign') {
        return schema.parse({
          id: body.conversationId || randomUUID(),
          contactId: dummyContactId,
          assignedAgentId: body.agentId,
          status: body.status || 'open',
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // GET paths
    if (path.startsWith('customer/')) {
      const contactId = path.split('customer/')[1]?.split('?')[0] || dummyContactId;
      return schema.parse({
        id: contactId,
        name: 'Sample Customer',
        phone: '+910000000000',
        email: null,
        company: null,
        address: null,
        createdAt: new Date().toISOString(),
      });
    }

    if (path.startsWith('customer')) {
      const match = path.match(/phone=([^&]+)/);
      const phone = match ? decodeURIComponent(match[1]) : '+910000000000';
      return schema.parse({
        id: dummyContactId,
        name: 'Sample Customer',
        phone,
        email: null,
        company: null,
        address: null,
        createdAt: new Date().toISOString(),
      });
    }

    if (path.startsWith('lead/')) {
      const leadId = path.split('lead/')[1]?.split('?')[0] || randomUUID();
      return schema.parse({
        id: leadId,
        contactId: dummyContactId,
        status: 'qualified',
        source: 'WhatsApp Referral',
        budget: 500000,
        requirements: '5kW Rooftop Solar Installation',
        createdAt: '2026-05-15T09:00:00Z',
      });
    }

    if (path.startsWith('proposal/')) {
      const propId = path.split('proposal/')[1]?.split('?')[0] || randomUUID();
      return schema.parse({
        id: propId,
        projectId: dummyProjectId,
        systemSizeKw: 5,
        totalAmount: 450000,
        status: 'draft',
        pdfUrl: null,
        createdAt: new Date().toISOString(),
      });
    }

    if (path.startsWith('proposals')) {
      return schema.parse([
        {
          id: randomUUID(),
          projectId: dummyProjectId,
          systemSizeKw: 5,
          totalAmount: 450000,
          status: 'draft',
          pdfUrl: null,
          createdAt: new Date().toISOString(),
        }
      ]);
    }

    if (path.startsWith('project/')) {
      const projId = path.split('project/')[1]?.split('?')[0] || dummyProjectId;
      return schema.parse({
        id: projId,
        contactId: dummyContactId,
        status: 'design',
        progressPercentage: 10,
        systemSizeKw: null,
        address: null,
        updatedAt: new Date().toISOString(),
      });
    }

    if (path.startsWith('projects')) {
      return schema.parse([
        {
          id: dummyProjectId,
          contactId: dummyContactId,
          status: 'design',
          progressPercentage: 10,
          systemSizeKw: null,
          address: null,
          updatedAt: new Date().toISOString(),
        }
      ]);
    }

    if (path.startsWith('installation/')) {
      const slotId = path.split('installation/')[1]?.split('?')[0] || randomUUID();
      return schema.parse({
        slotId,
        projectId: dummyProjectId,
        scheduledAt: new Date(Date.now() + 86400000 * 7).toISOString(),
        installerName: null,
        status: 'scheduled',
        netMeteringStatus: null,
      });
    }

    if (path.startsWith('installations')) {
      return schema.parse([
        {
          slotId: randomUUID(),
          projectId: dummyProjectId,
          scheduledAt: new Date(Date.now() + 86400000 * 7).toISOString(),
          installerName: null,
          status: 'scheduled',
          netMeteringStatus: null,
        }
      ]);
    }

    if (path.startsWith('followups')) {
      return schema.parse([]);
    }

    if (path.startsWith('documents')) {
      return schema.parse([]);
    }

    if (path.startsWith('invoice/')) {
      const invoiceId = path.split('invoice/')[1]?.split('?')[0] || randomUUID();
      return schema.parse({
        id: invoiceId,
        contactId: dummyContactId,
        amount: 150000,
        status: 'pending',
        dueDate: '2026-06-15T00:00:00Z',
        createdAt: '2026-05-20T10:00:00Z',
      });
    }

    if (path.startsWith('invoices')) {
      return schema.parse([
        {
          id: randomUUID(),
          contactId: dummyContactId,
          amount: 150000,
          status: 'pending',
          dueDate: '2026-06-15T00:00:00Z',
          createdAt: '2026-05-20T10:00:00Z',
        }
      ]);
    }

    throw new Error(`Mock handler for ${path} not implemented`);
  }
}

export const salesPortalConnector = new SalesPortalConnector();
