// src/app/api/tickets/analyze/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ticketAIService } from '@/modules/agents/services/ticket-ai-service';

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
    const { text } = body;

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Text parameter is required' }, { status: 400 });
    }

    const analysis = await ticketAIService.analyzeTicket({
      text: text.trim(),
      organizationId,
    });

    return NextResponse.json({ analysis });
  } catch (error: any) {
    console.error('[API Ticket Analyze] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
