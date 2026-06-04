import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { agentManager } from '@/modules/agents/services/agent-manager';
import { agentLoader } from '@/modules/agents/services/agent-loader';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';

export async function GET() {
  try {
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

    // Fetch existing configs
    const { data: existingAgents, error: fetchError } = await admin
      .from('agent_configs')
      .select('*')
      .eq('organization_id', organizationId);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const roles = ['supervisor', 'sales', 'support', 'installation', 'finance'] as const;
    
    // Seed any missing agent roles with defaults
    const existingRoles = new Set(existingAgents?.map((a) => a.role) || []);
    const missingRoles = roles.filter((role) => !existingRoles.has(role));

    if (missingRoles.length > 0) {
      for (const role of missingRoles) {
        const def = agentLoader.getDefaultConfig(organizationId, role);
        try {
          await agentManager.createAgent(
            organizationId,
            {
              name: def.name,
              description: def.description || undefined,
              role: def.role,
              systemPrompt: def.systemPrompt,
              allowedTools: def.allowedTools,
              model: def.model,
              temperature: def.temperature,
              kbAccess: def.kbAccess,
              status: def.status,
            },
            user.id
          );
        } catch (err: any) {
          console.error(`[API Agents] Failed to seed agent ${role}:`, err.message);
        }
      }

      // Re-fetch all configs after seeding
      const { data: refetchedAgents, error: refetchErr } = await admin
        .from('agent_configs')
        .select('*')
        .eq('organization_id', organizationId);

      if (refetchErr) {
        return NextResponse.json({ error: refetchErr.message }, { status: 500 });
      }

      return NextResponse.json({ agents: refetchedAgents ?? [] });
    }

    return NextResponse.json({ agents: existingAgents ?? [] });
  } catch (error: any) {
    console.error('[API Agents GET] Error:', error);
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
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const {
      name,
      description,
      role,
      systemPrompt,
      allowedTools,
      model,
      temperature,
      kbAccess,
      status,
    } = body;

    if (!name || !role || !systemPrompt) {
      return NextResponse.json(
        { error: 'name, role, and systemPrompt are required' },
        { status: 400 }
      );
    }

    const allowedRoles = ['supervisor', 'sales', 'support', 'installation', 'finance'];
    if (!allowedRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Allowed values: ${allowedRoles.join(', ')}` },
        { status: 400 }
      );
    }

    // Check if agent already exists
    const { data: existing } = await admin
      .from('agent_configs')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('role', role)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `Agent config for role '${role}' already exists for this organization. Use PATCH to update.` },
        { status: 409 }
      );
    }

    const agent = await agentManager.createAgent(
      organizationId,
      {
        name,
        description,
        role,
        systemPrompt,
        allowedTools,
        model,
        temperature,
        kbAccess,
        status,
      },
      user.id
    );

    return NextResponse.json({ agent }, { status: 201 });
  } catch (error: any) {
    console.error('[API Agents POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
