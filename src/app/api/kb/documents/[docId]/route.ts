import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { knowledgeBaseService } from '@/modules/rag/services/knowledge-base-service';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const { docId } = await params;
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

    const document = await knowledgeBaseService.getDocument(docId, organizationId);
    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    return NextResponse.json({ document });
  } catch (error: any) {
    console.error('[API KB Document GET] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const { docId } = await params;
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

    const document = await knowledgeBaseService.getDocument(docId, organizationId);
    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    await knowledgeBaseService.deleteDocument(docId, organizationId);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[API KB Document DELETE] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
