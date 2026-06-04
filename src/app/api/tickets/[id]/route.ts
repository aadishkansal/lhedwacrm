// src/app/api/tickets/[id]/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';
import { triggerTicketEvent } from '@/modules/workflows/services/crm-event-triggers';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const ticketId = resolvedParams.id;
    if (!ticketId) {
      return NextResponse.json({ error: 'Ticket ID is required' }, { status: 400 });
    }

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
    const { status, priority, category, assignedAgentId, resolutionNotes } = body;

    const admin = supabaseAdmin();
    // 1. Fetch current ticket to compare status
    const { data: currentTicket, error: fetchErr } = await admin
      .from('support_tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (fetchErr || !currentTicket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Build update object
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (category !== undefined) updates.category = category;
    if (assignedAgentId !== undefined) updates.assigned_agent_id = assignedAgentId || null;
    if (resolutionNotes !== undefined) updates.resolution_notes = resolutionNotes || null;

    // Resolution tracking telemetry
    if (status === 'resolved' && currentTicket.status !== 'resolved') {
      updates.resolved_at = new Date().toISOString();
      updates.resolved_by = user.id;
    } else if (status !== undefined && status !== 'resolved' && currentTicket.status === 'resolved') {
      updates.resolved_at = null;
      updates.resolved_by = null;
    }

    // 2. Perform database update
    const { data: updatedTicket, error: updateErr } = await admin
      .from('support_tickets')
      .update(updates)
      .eq('id', ticketId)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (updateErr || !updatedTicket) {
      return NextResponse.json({ error: updateErr?.message || 'Failed to update ticket' }, { status: 500 });
    }

    // 3. Trigger Ticket Event Workflow if status or priority changed
    if (
      status !== undefined && status !== currentTicket.status ||
      priority !== undefined && priority !== currentTicket.priority
    ) {
      try {
        await triggerTicketEvent({
          userId: user.id,
          contactId: updatedTicket.contact_id,
          ticketId: updatedTicket.id,
          status: updatedTicket.status,
          title: updatedTicket.title,
          priority: updatedTicket.priority,
        });
      } catch (workflowErr: any) {
        console.error('[API Ticket PATCH] Failed to trigger ticket workflow:', workflowErr.message);
      }
    }

    return NextResponse.json({ ticket: updatedTicket });
  } catch (error: any) {
    console.error('[API Ticket PATCH] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const ticketId = resolvedParams.id;
    if (!ticketId) {
      return NextResponse.json({ error: 'Ticket ID is required' }, { status: 400 });
    }

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

    // Soft delete by setting deleted_at
    const admin = supabaseAdmin();
    const { error: deleteErr } = await admin
      .from('support_tickets')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', ticketId)
      .eq('organization_id', organizationId);

    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API Ticket DELETE] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
