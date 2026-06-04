// src/app/api/routing/stats/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { teamRoutingService } from '@/modules/agents/services/team-routing-service';

export async function GET(request: Request) {
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
    const stats = await teamRoutingService.getPerformanceStats(organizationId);

    return NextResponse.json({ stats });
  } catch (error: any) {
    console.error('[API Routing Stats GET] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
