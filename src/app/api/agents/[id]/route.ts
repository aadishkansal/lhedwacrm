import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { agentManager } from '@/modules/agents/services/agent-manager';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';

export async function GET(
  _request: Request,
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

    // Resolve organization membership (use admin to bypass RLS on organization_users)
    const admin = supabaseAdmin();
    const { data: orgUser, error: orgError } = await admin
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

    const { data: agent, error: fetchError } = await admin
      .from('agent_configs')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({ agent });
  } catch (error: any) {
    console.error('[API Agent GET] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
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

    // Resolve organization membership (use admin to bypass RLS on organization_users)
    const admin = supabaseAdmin();
    const { data: orgUser, error: orgError } = await admin
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
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const updates: Record<string, any> = {};
    const allowedKeys = [
      'name',
      'description',
      'systemPrompt',
      'allowedTools',
      'model',
      'temperature',
      'kbAccess',
      'status',
    ];

    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        // Map camelCase from request body to camelCase parameters in UpdateAgentParams
        updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No update fields provided' }, { status: 400 });
    }

    // Pass user.id as userId to track who made the prompt change
    const updatedAgent = await agentManager.updateAgent(id, organizationId, {
      ...updates,
      userId: user.id,
    });

    return NextResponse.json({ agent: updatedAgent });
  } catch (error: any) {
    console.error('[API Agent PATCH] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
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

    // Resolve organization membership (use admin to bypass RLS on organization_users)
    const admin = supabaseAdmin();
    const { data: orgUser, error: orgError } = await admin
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

    await agentManager.deleteAgent(id, organizationId);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[API Agent DELETE] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

