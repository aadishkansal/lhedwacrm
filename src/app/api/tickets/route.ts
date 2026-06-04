// src/app/api/tickets/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';
import { triggerTicketEvent } from '@/modules/workflows/services/crm-event-triggers';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contactId');

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Resolve organization membership
    const { data: orgUser, error: orgError } = await supabase
      .from('organization_users')
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (orgError || !orgUser) {
      return NextResponse.json({ error: orgError?.message || 'No organization found' }, { status: 403 });
    }

    const organizationId = orgUser.organization_id;

    const admin = supabaseAdmin();
    // Fetch tickets for contact OR all organization tickets
    let query = admin
      .from('support_tickets')
      .select('*, contact:contacts(*)')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (contactId) {
      query = query.eq('contact_id', contactId);
    }

    const { data: tickets, error: ticketsError } = await query;

    if (ticketsError) {
      return NextResponse.json({ error: ticketsError.message }, { status: 500 });
    }

    // Fetch comment counts and conversation IDs for each ticket
    const ticketsWithDetails = await Promise.all(
      (tickets || []).map(async (ticket) => {
        const [commentRes, convRes] = await Promise.all([
          admin
            .from('ticket_comments')
            .select('*', { count: 'exact', head: true })
            .eq('ticket_id', ticket.id),
          admin
            .from('conversations')
            .select('id')
            .eq('contact_id', ticket.contact_id)
            .limit(1)
            .maybeSingle(),
        ]);

        return {
          ...ticket,
          commentCount: commentRes.count || 0,
          conversationId: convRes.data?.id || null,
        };
      })
    );

    return NextResponse.json({ tickets: ticketsWithDetails });
  } catch (error: any) {
    console.error('[API Tickets GET] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Resolve organization membership
    const { data: orgUser, error: orgError } = await supabase
      .from('organization_users')
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (orgError || !orgUser) {
      return NextResponse.json({ error: orgError?.message || 'No organization found' }, { status: 403 });
    }

    const organizationId = orgUser.organization_id;

    const body = await request.json();
    const { contactId, title, priority, category, assignedAgentId, initialNote } = body;

    if (!contactId || !title) {
      return NextResponse.json({ error: 'contactId and title are required' }, { status: 400 });
    }

    const admin = supabaseAdmin();
    // 1. Create Support Ticket
    const { data: ticket, error: ticketError } = await admin
      .from('support_tickets')
      .insert({
        organization_id: organizationId,
        contact_id: contactId,
        title,
        status: 'open',
        priority: priority || 'medium',
        category: category || 'general',
        assigned_agent_id: assignedAgentId || null,
      })
      .select()
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json({ error: ticketError?.message || 'Failed to create ticket' }, { status: 500 });
    }

    // 1.5 Run workload balancing to auto-assign a support agent to the new ticket
    let finalAssignedAgentId = assignedAgentId || null;
    if (!finalAssignedAgentId) {
      try {
        const { teamRoutingService } = await import('@/modules/agents/services/team-routing-service');
        const targetDept = (category && ['Sales', 'Support', 'Installation', 'Finance'].includes(category))
          ? category as any
          : 'Support';

        const routedAgentId = await teamRoutingService.routeTicket({
          ticketId: ticket.id,
          organizationId,
          department: targetDept,
        });
        if (routedAgentId) {
          finalAssignedAgentId = routedAgentId;
          ticket.assigned_agent_id = routedAgentId;
        }
      } catch (routingErr: any) {
        console.error('[API Tickets POST] Routing engine failed:', routingErr.message);
      }
    }

    // 2. Add Initial Note if provided
    if (initialNote && initialNote.trim()) {
      const { error: commentError } = await admin.from('ticket_comments').insert({
        ticket_id: ticket.id,
        organization_id: organizationId,
        author_id: user.id,
        content: initialNote.trim(),
        is_internal: true,
      });

      if (commentError) {
        console.error('[API Tickets POST] Failed to add initial note:', commentError.message);
      }
    }

    // 3. Trigger Ticket Event Workflow
    try {
      await triggerTicketEvent({
        userId: user.id,
        contactId,
        ticketId: ticket.id,
        status: ticket.status,
        title: ticket.title,
        priority: ticket.priority,
      });
    } catch (workflowErr: any) {
      console.error('[API Tickets POST] Failed to trigger ticket workflow:', workflowErr.message);
    }

    return NextResponse.json({ ticket });
  } catch (error: any) {
    console.error('[API Tickets POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
