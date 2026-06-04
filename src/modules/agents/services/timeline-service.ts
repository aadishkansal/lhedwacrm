// src/modules/agents/services/timeline-service.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { customerContextService } from '../../crm/services/customer-context-service';

export type TimelineEventType =
  | 'status_change'
  | 'assignment_change'
  | 'note_added'
  | 'tag_added'
  | 'tag_removed'
  | 'message_sent'
  | 'ai_escalated'
  | 'conversation_merged';

export interface LogTimelineEventParams {
  conversationId: string;
  organizationId: string;
  eventType: TimelineEventType;
  metadata: Record<string, any>;
  createdBy?: string; // agent auth user_id
}

export class TimelineService {
  /**
   * Logs an inbox event to the inbox_timeline_events table.
   */
  async logEvent(params: LogTimelineEventParams): Promise<void> {
    const db = supabaseAdmin();
    const { error } = await db
      .from('inbox_timeline_events')
      .insert({
        conversation_id: params.conversationId,
        organization_id: params.organizationId,
        event_type: params.eventType,
        metadata: params.metadata,
        created_by: params.createdBy || null,
      });

    if (error) {
      console.error('[TimelineService] Failed to log timeline event:', error.message);
    } else {
      console.log(`[TimelineService] Event logged: ${params.eventType} for conv ${params.conversationId}`);
    }
  }

  async getEvents(conversationId: string, organizationId: string) {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('inbox_timeline_events')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch timeline events: ${error.message}`);
    }

    const events = data || [];
    const creatorIds = Array.from(new Set(events.map(e => e.created_by).filter(Boolean)));

    if (creatorIds.length > 0) {
      const { data: profiles, error: profilesError } = await db
        .from('profiles')
        .select('user_id, full_name, avatar_url')
        .in('user_id', creatorIds);

      if (!profilesError && profiles) {
        const profileMap = new Map(profiles.map(p => [p.user_id, p]));
        return events.map(e => ({
          ...e,
          creator: e.created_by ? profileMap.get(e.created_by) || null : null
        }));
      }
    }

    return events.map(e => ({ ...e, creator: null }));
  }

  async getUnifiedTimeline(conversationId: string, contactId: string, organizationId: string) {
    const db = supabaseAdmin();

    // 1. Fetch WhatsApp Messages
    const { data: messages } = await db
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId);

    // 2. Fetch Timeline Events
    const timelineEvents = await this.getEvents(conversationId, organizationId);

    // 3. Fetch Tool Executions
    const { data: executions } = await db
      .from('agent_executions')
      .select('*, agent_tool_calls(*)')
      .eq('session_id', conversationId);

    // 4. Fetch Support Tickets
    const { data: tickets } = await db
      .from('support_tickets')
      .select('*')
      .eq('contact_id', contactId);

    // 5. Fetch Customer Context from CRM service
    let crmEvents: any[] = [];
    try {
      const ctx = await customerContextService.getCustomerContextByContactId(contactId);
      
      if (ctx.proposal && ctx.proposal.createdAt) {
        crmEvents.push({
          id: `proposal-${ctx.proposal.proposalId || 'default'}`,
          event_type: 'proposal_event',
          category: 'crm',
          title: 'Proposal Created',
          description: `Quote Status: ${ctx.proposal.quoteStatus || 'draft'} • Amount: $${ctx.proposal.totalAmount || 0} • System: ${ctx.proposal.systemSizeKw || 0} kW`,
          created_at: ctx.proposal.createdAt,
          metadata: ctx.proposal
        });
      }

      if (ctx.project && ctx.project.updatedAt) {
        crmEvents.push({
          id: `project-${ctx.project.projectId || 'default'}`,
          event_type: 'project_event',
          category: 'crm',
          title: 'Project Status Updated',
          description: `Current Stage: ${ctx.project.status || 'design'} (${ctx.project.progressPercentage || 0}% completed)`,
          created_at: ctx.project.updatedAt,
          metadata: ctx.project
        });
      }

      if (ctx.installation && ctx.installation.scheduledAt) {
        crmEvents.push({
          id: `installation-${ctx.installation.slotId || 'default'}`,
          event_type: 'installation_event',
          category: 'crm',
          title: `Installation ${ctx.installation.status || 'scheduled'}`,
          description: `Installer: ${ctx.installation.installerName || 'TBD'} • Scheduled: ${ctx.installation.scheduledAt}`,
          created_at: ctx.installation.scheduledAt,
          metadata: ctx.installation
        });
      }

      if (ctx.followups && ctx.followups.length > 0) {
        ctx.followups.forEach(f => {
          crmEvents.push({
            id: `followup-${f.followupId}`,
            event_type: 'followup_event',
            category: 'crm',
            title: `Follow-up ${f.status || 'pending'}`,
            description: f.notes || 'No follow-up notes.',
            created_at: f.scheduledAt,
            metadata: f
          });
        });
      }

      if (ctx.documents && ctx.documents.length > 0) {
        ctx.documents.forEach(d => {
          crmEvents.push({
            id: `document-${d.documentId}`,
            event_type: 'document_event',
            category: 'crm',
            title: `Document Uploaded: ${d.name}`,
            description: `Type: ${d.type.replace('_', ' ')}`,
            created_at: d.uploadedAt,
            metadata: d
          });
        });
      }
    } catch (err: any) {
      console.warn('[TimelineService] Failed to load CRM context events:', err.message);
    }

    // Map WhatsApp Messages
    const mappedMessages = (messages || []).map(m => {
      const isCustomer = m.sender_type === 'customer';
      const isBot = m.sender_type === 'bot';
      const senderLabel = isCustomer ? 'Customer' : (isBot ? 'AI Bot' : 'Agent');
      
      return {
        id: m.id,
        event_type: 'message',
        category: 'message',
        title: `Message from ${senderLabel}`,
        description: m.content_text || '',
        created_at: m.created_at,
        metadata: {
          sender_type: m.sender_type,
          content_type: m.content_type,
          status: m.status,
          reply_to_message_id: m.reply_to_message_id
        }
      };
    });

    // Map Timeline Events
    const mappedTimeline = timelineEvents.map(e => ({
      id: e.id,
      event_type: e.event_type,
      category: 'system',
      title: this.getTimelineEventTitle(e),
      description: this.getTimelineEventDescription(e),
      created_at: e.created_at,
      metadata: e.metadata,
      creator: e.creator
    }));

    // Map Tool Executions
    const mappedExecutions: any[] = [];
    (executions || []).forEach(exec => {
      const toolCalls = exec.agent_tool_calls || [];
      toolCalls.forEach((tc: any) => {
        mappedExecutions.push({
          id: tc.id,
          event_type: 'tool_call',
          category: 'ai',
          title: `Tool Executed: ${tc.tool_name}`,
          description: `Duration: ${tc.duration_ms || 0}ms`,
          created_at: tc.created_at || exec.created_at,
          metadata: {
            agent_name: exec.agent_name,
            tool_name: tc.tool_name,
            arguments: tc.arguments,
            result: tc.result,
            error_message: tc.error_message,
            duration_ms: tc.duration_ms,
            status: tc.error_message ? 'failed' : 'completed'
          }
        });
      });
    });

    // Map Support Tickets
    const mappedTickets = (tickets || []).map(t => ({
      id: t.id,
      event_type: 'ticket_event',
      category: 'crm',
      title: `Support Ticket: ${t.title}`,
      description: `Priority: ${t.priority} • Status: ${t.status}`,
      created_at: t.created_at,
      metadata: t
    }));

    // Combine and sort chronologically (descending)
    const allEvents = [
      ...mappedMessages,
      ...mappedTimeline,
      ...mappedExecutions,
      ...mappedTickets,
      ...crmEvents
    ];

    allEvents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return allEvents;
  }

  private getTimelineEventTitle(e: any): string {
    switch (e.event_type) {
      case 'status_change':
        return `Status marked ${e.metadata.status}`;
      case 'assignment_change':
        return e.metadata.assigned_agent_id ? `Assigned to ${e.metadata.agent_name}` : 'Conversation unassigned';
      case 'note_added':
        return 'Internal Note Added';
      case 'tag_added':
        return `Tag Added: ${e.metadata.tag_name}`;
      case 'tag_removed':
        return `Tag Removed: ${e.metadata.tag_name}`;
      case 'message_sent':
        return 'AI Auto-response Sent';
      case 'ai_escalated':
        return 'Conversation Escalated';
      case 'conversation_merged':
        return 'Conversation Merged';
      default:
        return e.event_type;
    }
  }

  private getTimelineEventDescription(e: any): string {
    const creatorName = e.creator?.full_name || 'System';
    switch (e.event_type) {
      case 'status_change':
        return `Changed by ${creatorName}`;
      case 'assignment_change':
        return `Updated by ${creatorName}`;
      case 'note_added':
        return `"${e.metadata.note_text}" — by ${creatorName}`;
      case 'tag_added':
        return `Added by ${creatorName}`;
      case 'tag_removed':
        return `Removed by ${creatorName}`;
      case 'message_sent':
        return e.metadata.message_text ? `"${e.metadata.message_text}"` : '';
      case 'ai_escalated':
        return `Triggered by ${creatorName}. Reason: ${e.metadata.message_text}`;
      case 'conversation_merged':
        return `Merged duplicate contact "${e.metadata.source_contact_name}" — by ${creatorName}`;
      default:
        return '';
    }
  }
}

export const timelineService = new TimelineService();
