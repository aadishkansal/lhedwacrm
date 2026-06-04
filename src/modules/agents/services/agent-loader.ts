// src/modules/agents/services/agent-loader.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';

export interface AgentConfig {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  role: 'supervisor' | 'sales' | 'support' | 'installation' | 'finance';
  systemPrompt: string;
  allowedTools: string[];
  model: string;
  temperature: number;
  kbAccess: boolean;
  status: 'active' | 'inactive';
  currentVersion: number;
}

export class AgentLoader {
  private cache = new Map<string, { config: AgentConfig; expiresAt: number }>();
  private cacheTtlMs: number;

  constructor(cacheTtlMs = 5 * 60 * 1000) {
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Load agent configuration from database by role. Falls back to hardcoded default if not found in DB.
   */
  async loadAgent(organizationId: string, role: 'supervisor' | 'sales' | 'support' | 'installation' | 'finance'): Promise<AgentConfig> {
    const cacheKey = `${organizationId}:${role}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() <= cached.expiresAt) {
      return cached.config;
    }

    const db = supabaseAdmin();
    const { data, error } = await db
      .from('agent_configs')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('role', role)
      .eq('status', 'active')
      .maybeSingle();

    let config: AgentConfig;

    if (error || !data) {
      // Return default config if DB query fails or no record exists
      config = this.getDefaultConfig(organizationId, role);
    } else {
      config = {
        id: data.id,
        organizationId: data.organization_id,
        name: data.name,
        description: data.description,
        role: data.role,
        systemPrompt: data.system_prompt,
        allowedTools: data.allowed_tools || [],
        model: data.model,
        temperature: Number(data.temperature),
        kbAccess: data.kb_access,
        status: data.status,
        currentVersion: data.current_version,
      };
    }

    this.cache.set(cacheKey, {
      config,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return config;
  }

  /**
   * Clear loader cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Fallback default configs.
   */
  public getDefaultConfig(orgId: string, role: 'supervisor' | 'sales' | 'support' | 'installation' | 'finance'): AgentConfig {
    const defaults: Record<string, Omit<AgentConfig, 'organizationId' | 'role'>> = {
      supervisor: {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Supervisor Agent',
        description: 'Default Supervisor Agent',
        systemPrompt: `You are a Senior AI Supervisor for a Solar EPC company.
Analyze the customer's incoming message and CRM profile. Decide which department is best suited or if we must handoff to a human.

Departments & Scope:
- Sales: Inquiries about purchasing, price quotes, solar recommendations, system capacities, deal status, booking site surveys.
- Support: Inverter faults, panel leaks, broken rails, warranty claims, logging support tickets.
- Installation: Slot schedules, permitting stage, physical panel setup date, net metering connection status.
- Finance: Invoices, unpaid bills, installment options, payment links, billing queries.

Customer Profile:
- Name: {{customer_name}}
- Project Stage: {{project_status}}
- Active Deal Stage: {{lead_status}}

Incoming Message:
"{{message_text}}"

Rules:
- If the customer explicitly requests a human ("talk to agent", "human representative", "help"), set humanHandoff to true and routingDecision to 'escalate_to_human'.
- If the confidence of department routing is low (< 0.70), set routingDecision to 'escalate_to_human'.
- Set priority to 'critical' if they complain about hazard/fire/leaks/safety. Set to 'high' for inverter breakdown or quotes waiting.`,
        allowedTools: [],
        model: 'gemini-2.5-flash',
        temperature: 0.1,
        kbAccess: false,
        status: 'active',
        currentVersion: 1,
      },
      sales: {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Sales Agent',
        description: 'Default Sales Agent',
        systemPrompt: `You are a specialized AI Sales Agent for a Solar EPC company.
Your goal is to qualify leads, explain quotations/proposals, recommend solar configurations, and book site visits.

Customer Profile:
- Name: {{customer_name}}
- Phone: {{customer_phone}}
- Budget: {{lead_budget}}
- Requirements: {{lead_requirements}}

Deals & Proposals:
- Converted Status: {{conversion_status}}
- Active Project ID: {{project_id}}
- Latest Proposal Size: {{proposal_size}} kW
- Proposal Amount: {{proposal_amount}}
- Proposal Status: {{proposal_status}}

Be helpful, concise, and professional. Use tools if you need to fetch documents, check follow-ups, look up proposals, or create tickets.
If the customer wants to buy, offer to schedule a site visit using follow-up/appointment check.
If you cannot answer, or need human help, call AssignHumanAgent tool to escalate.`,
        allowedTools: [
          'GetCustomerContext',
          'GetProposal',
          'GetPendingFollowups',
          'GetCustomerDocuments',
          'AssignHumanAgent',
          'CreateSupportTicket',
          'SendWhatsAppMessage',
        ],
        model: 'gemini-2.5-flash',
        temperature: 0.3,
        kbAccess: false,
        status: 'active',
        currentVersion: 1,
      },
      support: {
        id: '00000000-0000-0000-0000-000000000003',
        name: 'Support Agent',
        description: 'Default Support Agent',
        systemPrompt: `You are a specialized AI Technical Support Agent for a Solar EPC company.
Your goal is to address customer complaints, answer technical/warranty queries, and log support tickets for physical fixes.

Customer Context:
- Name: {{customer_name}}
- Project ID: {{project_id}}
- Active Project Stage: {{project_status}}

If the customer complains about a leak, inverter fault (e.g. error code), or broken panel, explain that you will create a support ticket and call the CreateSupportTicket tool.
Keep the customer updated with the ticket creation result. Be empathetic and clear.`,
        allowedTools: [
          'GetCustomerContext',
          'CreateSupportTicket',
          'GetPendingFollowups',
          'AssignHumanAgent',
          'SendWhatsAppMessage',
        ],
        model: 'gemini-2.5-flash',
        temperature: 0.3,
        kbAccess: false,
        status: 'active',
        currentVersion: 1,
      },
      installation: {
        id: '00000000-0000-0000-0000-000000000004',
        name: 'Installation Agent',
        description: 'Default Installation Agent',
        systemPrompt: `You are a specialized AI Installation & Operations Agent for a Solar EPC company.
Your goal is to check rooftop installation progress, scheduled slots, permitting status, and net metering.

Customer Context:
- Name: {{customer_name}}
- Project ID: {{project_id}}
- Project Stage: {{project_status}}
- Installation Slot ID: {{installation_slot_id}}
- Installation Date: {{installation_date}}

To retrieve current status, use GetProjectProgress or GetInstallationSchedule tools.
Always explain the next steps (e.g., waiting for permit approval, net metering application submitted, setup scheduled).`,
        allowedTools: [
          'GetCustomerContext',
          'GetProjectProgress',
          'GetInstallationSchedule',
          'AssignHumanAgent',
          'SendWhatsAppMessage',
        ],
        model: 'gemini-2.5-flash',
        temperature: 0.3,
        kbAccess: false,
        status: 'active',
        currentVersion: 1,
      },
      finance: {
        id: '00000000-0000-0000-0000-000000000005',
        name: 'Finance Agent',
        description: 'Default Finance Agent',
        systemPrompt: `You are a specialized AI Billing & Finance Agent for a Solar EPC company.
Your goal is to assist customers with payments, outstanding invoices, bill copies, and pricing summaries.

Customer Context:
- Name: {{customer_name}}
- Invoices Pending: {{pending_invoices_count}}

Call the GetInvoiceStatus tool to lookup paid/unpaid bills, amounts, and due dates.
Do not share sensitive banking details directly unless requested, but provide total amounts and due dates clearly.`,
        allowedTools: [
          'GetCustomerContext',
          'GetInvoiceStatus',
          'AssignHumanAgent',
          'SendWhatsAppMessage',
        ],
        model: 'gemini-2.5-flash',
        temperature: 0.3,
        kbAccess: false,
        status: 'active',
        currentVersion: 1,
      },
    };

    return {
      ...defaults[role],
      organizationId: orgId,
      role,
    };
  }
}

export const agentLoader = new AgentLoader();
