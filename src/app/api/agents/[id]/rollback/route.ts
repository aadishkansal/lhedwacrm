import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';
import { agentManager } from '@/modules/agents/services/agent-manager';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Resolve organization membership
    const { data: orgUser, error: orgError } = await supabaseAdmin()
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

    const body = await request.json().catch(() => null);
    if (!body || typeof body.version !== 'number') {
      return NextResponse.json({ error: 'Valid version number is required' }, { status: 400 });
    }

    const updatedAgent = await agentManager.rollbackPrompt(
      id,
      organizationId,
      body.version,
      user.id
    );

    return NextResponse.json({ agent: updatedAgent });
  } catch (error: any) {
    console.error('[API Agent Rollback POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
