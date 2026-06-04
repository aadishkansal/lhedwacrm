import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { knowledgeBaseService } from '@/modules/rag/services/knowledge-base-service';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';

export async function GET(
  _request: Request,
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

    const documents = await knowledgeBaseService.getDocuments(kbId, organizationId);
    return NextResponse.json({ documents });
  } catch (error: any) {
    console.error('[API KB Documents GET] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

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

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: 'Multipart form data is required' }, { status: 400 });
    }

    const file = formData.get('file') as File | null;
    const title = formData.get('title') as string | null;
    const category = formData.get('category') as any;

    if (!file || !title || !category) {
      return NextResponse.json(
        { error: 'file, title, and category are required fields' },
        { status: 400 }
      );
    }

    // Validate category
    const allowedCategories = [
      'Company Information',
      'Solar Products',
      'Warranty Documents',
      'Subsidy Documents',
      'Installation Guides',
      'Policies',
      'Sales Scripts',
    ];

    if (!allowedCategories.includes(category)) {
      return NextResponse.json(
        { error: `Invalid category. Allowed values: ${allowedCategories.join(', ')}` },
        { status: 400 }
      );
    }

    // Infer file type from extension if not explicitly specified
    const fileName = file.name || 'document.txt';
    const ext = fileName.split('.').pop()?.toLowerCase();
    let fileType = formData.get('fileType') as string | null;

    if (!fileType) {
      if (ext === 'pdf') fileType = 'pdf';
      else if (ext === 'docx') fileType = 'docx';
      else if (ext === 'md' || ext === 'markdown') fileType = 'markdown';
      else if (ext === 'json') fileType = 'faq';
      else fileType = 'txt';
    }

    const allowedFileTypes = ['pdf', 'docx', 'txt', 'faq', 'markdown'];
    if (!allowedFileTypes.includes(fileType)) {
      return NextResponse.json(
        { error: `Invalid fileType. Allowed values: ${allowedFileTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Parse file contents to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Call service to register document and trigger background embeddings extraction
    const doc = await knowledgeBaseService.uploadDocument({
      kbId,
      organizationId,
      buffer,
      fileName,
      title,
      fileType: fileType as any,
      category: category as any,
      userId: user.id,
    });

    return NextResponse.json({ document: doc }, { status: 202 });
  } catch (error: any) {
    console.error('[API KB Documents POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
