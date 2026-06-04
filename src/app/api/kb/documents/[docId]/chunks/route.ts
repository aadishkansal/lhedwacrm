import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';

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

    // Verify document ownership/existence under user's organization
    const admin = supabaseAdmin();
    const { data: document, error: docError } = await admin
      .from('kb_documents')
      .select('*')
      .eq('id', docId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (docError) {
      return NextResponse.json({ error: docError.message }, { status: 500 });
    }

    if (!document) {
      return NextResponse.json({ error: 'Document not found or inaccessible' }, { status: 404 });
    }

    // Fetch chunks associated with the document
    const { data: chunks, error: chunksError } = await admin
      .from('document_chunks')
      .select('id, content, metadata, created_at')
      .eq('document_id', docId)
      .order('created_at', { ascending: true });

    if (chunksError) {
      return NextResponse.json({ error: chunksError.message }, { status: 500 });
    }

    return NextResponse.json({ document, chunks: chunks ?? [] });
  } catch (error: any) {
    console.error('[API KB Document Chunks GET] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
