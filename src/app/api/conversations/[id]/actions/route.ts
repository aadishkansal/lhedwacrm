import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';
import { timelineService } from '@/modules/agents/services/timeline-service';
import { supervisorAgent } from '@/modules/agents/services/supervisor-agent';
import { engineSendText } from '@/modules/workflows/services/meta-send';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
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

    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 500 });
    }

    if (!orgUser) {
      return NextResponse.json({ error: 'No organization found for user' }, { status: 403 });
    }

    const organizationId = orgUser.organization_id;

    // Verify conversation existence and organization membership
    const db = supabaseAdmin();
    const { data: conv, error: convError } = await db
      .from('conversations')
      .select('*, contact:contacts(organization_id, name, phone)')
      .eq('id', conversationId)
      .maybeSingle();

    if (convError) {
      return NextResponse.json({ error: convError.message }, { status: 500 });
    }

    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const contactOrg = (conv.contact as any)?.organization_id;
    if (contactOrg !== organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.action) {
      return NextResponse.json({ error: 'Missing action parameter' }, { status: 400 });
    }

    const { action } = body;

    if (action === 'assign') {
      const { assignedAgentId } = body;
      const newAgentId = assignedAgentId === 'unassigned' || assignedAgentId === '' ? null : assignedAgentId;

      // Update DB
      const { data: updatedConv, error: updateError } = await db
        .from('conversations')
        .update({
          assigned_agent_id: newAgentId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .select('*')
        .single();

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      // Fetch teammate profile if assigned
      let agentName = 'Unassigned';
      if (newAgentId) {
        const { data: profile } = await db
          .from('profiles')
          .select('full_name')
          .eq('user_id', newAgentId)
          .maybeSingle();
        if (profile) {
          agentName = profile.full_name;
        }
      }

      // Log event to timeline
      await timelineService.logEvent({
        conversationId,
        organizationId,
        eventType: 'assignment_change',
        metadata: {
          assigned_agent_id: newAgentId,
          agent_name: agentName,
          changed_by: user.id,
        },
        createdBy: user.id,
      });

      return NextResponse.json({ success: true, conversation: updatedConv });
    }

    if (action === 'status') {
      const { status } = body;
      if (!['open', 'pending', 'closed'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }

      // Update DB
      const { data: updatedConv, error: updateError } = await db
        .from('conversations')
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .select('*')
        .single();

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      // Log event to timeline
      await timelineService.logEvent({
        conversationId,
        organizationId,
        eventType: 'status_change',
        metadata: {
          status,
          changed_by: user.id,
        },
        createdBy: user.id,
      });

      return NextResponse.json({ success: true, conversation: updatedConv });
    }

    if (action === 'toggle-bot') {
      const { isBotActive } = body;
      if (typeof isBotActive !== 'boolean') {
        return NextResponse.json({ error: 'Invalid isBotActive parameter' }, { status: 400 });
      }

      // Update DB
      const { data: updatedConv, error: updateError } = await db
        .from('conversations')
        .update({
          is_bot_active: isBotActive,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .select('*')
        .single();

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      // Log event to timeline
      await timelineService.logEvent({
        conversationId,
        organizationId,
        eventType: 'status_change',
        metadata: {
          is_bot_active: isBotActive,
          changed_by: user.id,
        },
        createdBy: user.id,
      });

      return NextResponse.json({ success: true, conversation: updatedConv });
    }

    if (action === 'escalate') {
      // 1. Set status to pending and unassign agent
      const { data: updatedConv, error: updateError } = await db
        .from('conversations')
        .update({
          status: 'pending',
          assigned_agent_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .select('*')
        .single();

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      // 2. Fetch last customer message for supervisor agent context
      const { data: lastCustomerMsg } = await db
        .from('messages')
        .select('content_text')
        .eq('conversation_id', conversationId)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const messageText = lastCustomerMsg?.content_text || 'Customer requested human escalation';

      // 3. Log AI Escalated Event in timeline
      await timelineService.logEvent({
        conversationId,
        organizationId,
        eventType: 'ai_escalated',
        metadata: {
          escalated_by: user.id,
          message_text: messageText,
        },
        createdBy: user.id,
      });

      // 4. Run Supervisor Agent dynamic classification in background
      void (async () => {
        try {
          // Fetch conversation history
          const { data: dbMessages } = await db
            .from('messages')
            .select('sender_type, content_text')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true })
            .limit(10);

          const history = (dbMessages || [])
            .filter(m => m.sender_type === 'customer' || m.sender_type === 'bot' || m.sender_type === 'agent')
            .map(m => ({
              role: m.sender_type === 'customer' ? 'user' as const : 'assistant' as const,
              content: m.content_text || '',
            }));

          const replyText = await supervisorAgent.routeMessage({
            contactId: conv.contact_id,
            organizationId,
            conversationId,
            messageText,
            userId: user.id,
            history,
          });

          // Send the SupervisorAgent / department reply via WhatsApp API
          await engineSendText({
            userId: user.id,
            conversationId,
            contactId: conv.contact_id,
            text: replyText,
          });

          // Log message sent event in timeline
          await timelineService.logEvent({
            conversationId,
            organizationId,
            eventType: 'message_sent',
            metadata: {
              sender_type: 'bot',
              message_text: replyText,
            },
          });
        } catch (err: any) {
          console.error('[API Escalate] Background routing failed:', err.message);
        }
      })();

      return NextResponse.json({ success: true, conversation: updatedConv });
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error: any) {
    console.error('[API Conversation Actions POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
