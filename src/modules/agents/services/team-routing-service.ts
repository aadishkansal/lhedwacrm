// src/modules/agents/services/team-routing-service.ts

import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { supabaseAdmin } from '../../workflows/services/admin-client';

export type RoutingDept = 'Sales' | 'Support' | 'Installation' | 'Finance';

export interface RouteConversationParams {
  conversationId: string;
  organizationId: string;
  department?: RoutingDept;
  isEscalation?: boolean;
}

export interface RouteTicketParams {
  ticketId: string;
  organizationId: string;
  department?: RoutingDept; // default Support
  isEscalation?: boolean;
}

export class TeamRoutingService {
  /**
   * Routes an inbox conversation to the best agent in a department using workload balancing.
   */
  async routeConversation(params: RouteConversationParams): Promise<{ assignedAgentId: string | null; department: RoutingDept }> {
    const startedAt = Date.now();
    const db = supabaseAdmin();
    let targetDept = params.department;

    console.log(`[TeamRoutingService] Routing conversation ${params.conversationId} for org ${params.organizationId}`);

    // 1. Intent Classification via LLM if department not provided
    if (!targetDept) {
      try {
        const { data: messages } = await db
          .from('messages')
          .select('content_text, sender_type')
          .eq('conversation_id', params.conversationId)
          .order('created_at', { ascending: false })
          .limit(5);

        const chatText = (messages || [])
          .reverse()
          .map(m => `${m.sender_type === 'customer' ? 'User' : 'Agent'}: ${m.content_text || ''}`)
          .join('\n');

        const classificationPrompt = `
Analyze the customer's messages and classify the conversation's core intent into exactly one of these departments:
- Sales: General solar inquiries, pricing request, solar product spec sheets, booking site surveys.
- Support: System failures, warranty inquiries, ticket updates, technical problems.
- Installation: Site visit scheduling, mounting structures, net metering schedules.
- Finance: Invoices, outstanding balances, installment options, payment processing.

Recent Chat:
${chatText || 'No chat history available.'}
`;

        const { object: classification } = await generateObject({
          model: google('gemini-2.5-flash'),
          schema: z.object({
            department: z.enum(['Sales', 'Support', 'Installation', 'Finance']),
          }),
          system: 'You are an AI intent classifier for a Solar EPC customer service routing engine.',
          prompt: classificationPrompt,
          temperature: 0.1,
        });

        targetDept = classification.department as RoutingDept;
        console.log(`[TeamRoutingService] Intent classified conversation as: ${targetDept}`);
      } catch (err: any) {
        console.error('[TeamRoutingService] Intent classification failed, defaulting to Sales:', err.message);
        targetDept = 'Sales';
      }
    }

    // 2. Fetch current conversation details for logging previous agent
    const { data: conv } = await db
      .from('conversations')
      .select('assigned_agent_id')
      .eq('id', params.conversationId)
      .single();
    const prevAgentId = conv?.assigned_agent_id || null;

    // 3. Workload Balancing: Find all active agents in this department
    const { data: departmentUsers } = await db
      .from('organization_users')
      .select('user_id')
      .eq('organization_id', params.organizationId)
      .eq('department', targetDept);

    let assignedAgentId: string | null = null;
    const workloads: Array<{ userId: string; count: number }> = [];

    if (departmentUsers && departmentUsers.length > 0) {
      // Count active conversations assigned to each agent
      await Promise.all(
        departmentUsers.map(async (u) => {
          const { count } = await db
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('assigned_agent_id', u.user_id)
            .eq('status', 'open');
          
          workloads.push({ userId: u.user_id, count: count ?? 0 });
        })
      );

      // Sort by workload ascending (lowest workload first)
      workloads.sort((a, b) => a.count - b.count);
      assignedAgentId = workloads[0].userId;
      console.log(`[TeamRoutingService] Selected agent ${assignedAgentId} with active conversation workload of ${workloads[0].count}`);
    } else {
      console.log(`[TeamRoutingService] No active human agents found assigned to department ${targetDept}`);
    }

    // 4. Automatic Assignment: Update conversation record
    const finalAgentId = assignedAgentId || prevAgentId;
    await db
      .from('conversations')
      .update({
        assigned_agent_id: finalAgentId,
        assigned_department: targetDept,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.conversationId);

    // 5. Log Timeline Event
    if (finalAgentId && finalAgentId !== prevAgentId) {
      await db.from('inbox_timeline_events').insert({
        organization_id: params.organizationId,
        conversation_id: params.conversationId,
        event_type: 'assignment_change',
        title: 'Conversation Auto-Assigned',
        description: `Assigned to ${targetDept} agent due to workload balancing.`,
        metadata: {
          department: targetDept,
          assigned_agent_id: finalAgentId,
          previous_agent_id: prevAgentId,
          is_escalation: params.isEscalation ?? false,
        },
      });
    }

    // 6. Performance Tracking: Log to team_routing_logs
    const duration = Date.now() - startedAt;
    await db.from('team_routing_logs').insert({
      organization_id: params.organizationId,
      conversation_id: params.conversationId,
      classified_department: targetDept,
      previous_agent_id: prevAgentId,
      assigned_agent_id: finalAgentId,
      routing_duration_ms: duration,
      is_escalation: params.isEscalation ?? false,
    });

    return { assignedAgentId: finalAgentId, department: targetDept };
  }

  /**
   * Routes a support ticket to the best support agent using workload balancing.
   */
  async routeTicket(params: RouteTicketParams): Promise<string | null> {
    const startedAt = Date.now();
    const db = supabaseAdmin();
    const targetDept = params.department || 'Support';

    console.log(`[TeamRoutingService] Routing ticket ${params.ticketId} for org ${params.organizationId} (Dept: ${targetDept})`);

    // 1. Fetch current ticket details for previous agent
    const { data: ticket } = await db
      .from('support_tickets')
      .select('assigned_agent_id, category')
      .eq('id', params.ticketId)
      .single();
    const prevAgentId = ticket?.assigned_agent_id || null;

    // 2. Workload Balancing: Find all active agents in this department
    const { data: departmentUsers } = await db
      .from('organization_users')
      .select('user_id')
      .eq('organization_id', params.organizationId)
      .eq('department', targetDept);

    let assignedAgentId: string | null = null;
    const workloads: Array<{ userId: string; count: number }> = [];

    if (departmentUsers && departmentUsers.length > 0) {
      // Count active tickets assigned to each agent
      await Promise.all(
        departmentUsers.map(async (u) => {
          const { count } = await db
            .from('support_tickets')
            .select('id', { count: 'exact', head: true })
            .eq('assigned_agent_id', u.user_id)
            .eq('status', 'open');
          
          workloads.push({ userId: u.user_id, count: count ?? 0 });
        })
      );

      // Sort by workload ascending (lowest workload first)
      workloads.sort((a, b) => a.count - b.count);
      assignedAgentId = workloads[0].userId;
      console.log(`[TeamRoutingService] Selected ticket agent ${assignedAgentId} with active ticket workload of ${workloads[0].count}`);
    } else {
      console.log(`[TeamRoutingService] No support agents found assigned to department ${targetDept}`);
    }

    // 3. Automatic Assignment: Update ticket record
    const finalAgentId = assignedAgentId || prevAgentId;
    await db
      .from('support_tickets')
      .update({
        assigned_agent_id: finalAgentId,
        category: ticket?.category || targetDept.toLowerCase(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.ticketId);

    // 4. Performance Tracking: Log to team_routing_logs
    const duration = Date.now() - startedAt;
    await db.from('team_routing_logs').insert({
      organization_id: params.organizationId,
      ticket_id: params.ticketId,
      classified_department: targetDept,
      previous_agent_id: prevAgentId,
      assigned_agent_id: finalAgentId,
      routing_duration_ms: duration,
      is_escalation: params.isEscalation ?? false,
    });

    return finalAgentId;
  }

  /**
   * Computes routing performance and workload balancing stats.
   * Satisfies the "Performance Tracking" requirement.
   */
  async getPerformanceStats(organizationId: string) {
    const db = supabaseAdmin();

    // 1. Fetch routing logs
    const { data: logs, error: logsError } = await db
      .from('team_routing_logs')
      .select('classified_department, routing_duration_ms, assigned_agent_id, is_escalation, created_at')
      .eq('organization_id', organizationId);

    if (logsError || !logs) {
      console.error('[TeamRoutingService] Failed to fetch routing logs:', logsError?.message);
      return this.emptyStats();
    }

    const totalRouted = logs.length;
    let totalDuration = 0;
    let escalationCount = 0;
    let unassignedCount = 0;

    const departmentDistribution: Record<string, number> = {};

    logs.forEach(log => {
      totalDuration += log.routing_duration_ms;
      if (log.is_escalation) escalationCount++;
      if (!log.assigned_agent_id) unassignedCount++;
      departmentDistribution[log.classified_department] = (departmentDistribution[log.classified_department] || 0) + 1;
    });

    const averageRoutingDurationMs = totalRouted > 0 ? Math.round(totalDuration / totalRouted) : 0;
    const unassignedRate = totalRouted > 0 ? Number(((unassignedCount / totalRouted) * 100).toFixed(1)) : 0.0;

    // 2. Fetch agent workloads
    const { data: orgUsers } = await db
      .from('organization_users')
      .select('user_id, department')
      .eq('organization_id', organizationId);

    const agentWorkloads: Array<{
      userId: string;
      department: string | null;
      activeConversations: number;
      activeTickets: number;
    }> = [];

    if (orgUsers && orgUsers.length > 0) {
      await Promise.all(
        orgUsers.map(async (u) => {
          const [{ count: convCount }, { count: ticketCount }] = await Promise.all([
            db.from('conversations').select('id', { count: 'exact', head: true }).eq('assigned_agent_id', u.user_id).eq('status', 'open'),
            db.from('support_tickets').select('id', { count: 'exact', head: true }).eq('assigned_agent_id', u.user_id).eq('status', 'open'),
          ]);

          agentWorkloads.push({
            userId: u.user_id,
            department: u.department,
            activeConversations: convCount ?? 0,
            activeTickets: ticketCount ?? 0,
          });
        })
      );
    }

    return {
      totalRouted,
      averageRoutingDurationMs,
      escalationCount,
      unassignedRate,
      departmentDistribution,
      agentWorkloads,
    };
  }

  private emptyStats() {
    return {
      totalRouted: 0,
      averageRoutingDurationMs: 0,
      escalationCount: 0,
      unassignedRate: 0.0,
      departmentDistribution: {},
      agentWorkloads: [],
    };
  }
}

export const teamRoutingService = new TeamRoutingService();
