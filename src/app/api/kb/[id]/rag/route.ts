import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ragEngine } from '@/modules/rag/services/rag-service';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: kbId } = await params;
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

    // Verify KB ownership/existence
    const admin = supabaseAdmin();
    const { data: kb } = await admin
      .from('knowledge_bases')
      .select('id')
      .eq('id', kbId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (!kb) {
      return NextResponse.json({ error: 'Knowledge Base not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.query) {
      return NextResponse.json({ error: 'query is required in the body' }, { status: 400 });
    }

    const reqOptions = {
      kbId,
      organizationId,
      contactId: body.contactId || undefined,
      query: body.query.trim(),
      history: body.history || undefined,
      filters: body.filters || undefined,
      threshold: body.threshold !== undefined ? Number(body.threshold) : undefined,
      limit: body.limit !== undefined ? Number(body.limit) : undefined,
    };

    const ragResponse = await ragEngine.generateResponse(reqOptions);
    return NextResponse.json(ragResponse);
  } catch (error: any) {
    console.error('[API KB RAG POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
