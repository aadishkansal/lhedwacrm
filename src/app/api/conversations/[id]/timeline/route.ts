import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';
import { timelineService } from '@/modules/agents/services/timeline-service';

export async function GET(
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

    // Verify conversation membership and existence
    const db = supabaseAdmin();
    const { data: conv, error: convError } = await db
      .from('conversations')
      .select('id, contact_id, contact:contacts(organization_id)')
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
      return NextResponse.json({ error: 'Forbidden: Conversation is outside your organization' }, { status: 403 });
    }

    // Fetch unified chronological timeline events
    const events = await timelineService.getUnifiedTimeline(conversationId, conv.contact_id, organizationId);

    return NextResponse.json({ events });
  } catch (error: any) {
    console.error('[API Conversation Timeline GET] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
