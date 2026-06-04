import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';
import { timelineService } from '@/modules/agents/services/timeline-service';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: targetConversationId } = await params;
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

    const body = await request.json().catch(() => null);
    if (!body || !body.sourceConversationId) {
      return NextResponse.json({ error: 'Missing sourceConversationId parameter' }, { status: 400 });
    }

    const { sourceConversationId } = body;

    if (sourceConversationId === targetConversationId) {
      return NextResponse.json({ error: 'Cannot merge a conversation into itself' }, { status: 400 });
    }

    const db = supabaseAdmin();

    // 1. Fetch and verify target conversation
    const { data: targetConv, error: targetConvError } = await db
      .from('conversations')
      .select('*, contact:contacts(organization_id, name, phone)')
      .eq('id', targetConversationId)
      .maybeSingle();

    if (targetConvError || !targetConv) {
      return NextResponse.json({ error: 'Target conversation not found' }, { status: 404 });
    }

    const targetOrg = (targetConv.contact as any)?.organization_id;
    if (targetOrg !== organizationId) {
      return NextResponse.json({ error: 'Forbidden: Target conversation outside organization' }, { status: 403 });
    }

    // 2. Fetch and verify source conversation
    const { data: sourceConv, error: sourceConvError } = await db
      .from('conversations')
      .select('*, contact:contacts(organization_id, name, phone)')
      .eq('id', sourceConversationId)
      .maybeSingle();

    if (sourceConvError || !sourceConv) {
      return NextResponse.json({ error: 'Source conversation not found' }, { status: 404 });
    }

    const sourceOrg = (sourceConv.contact as any)?.organization_id;
    if (sourceOrg !== organizationId) {
      return NextResponse.json({ error: 'Forbidden: Source conversation outside organization' }, { status: 403 });
    }

    const targetContactId = targetConv.contact_id;
    const sourceContactId = sourceConv.contact_id;
    const sourceContactName = (sourceConv.contact as any)?.name || (sourceConv.contact as any)?.phone || 'Unknown';

    // 3. Move messages from source conversation to target conversation
    const { error: msgErr } = await db
      .from('messages')
      .update({ conversation_id: targetConversationId })
      .eq('conversation_id', sourceConversationId);

    if (msgErr) {
      return NextResponse.json({ error: `Failed to merge messages: ${msgErr.message}` }, { status: 500 });
    }

    // 4. Move contact notes from source contact to target contact
    const { error: notesErr } = await db
      .from('contact_notes')
      .update({ contact_id: targetContactId })
      .eq('contact_id', sourceContactId);

    if (notesErr) {
      console.error('[API Merge] Notes move failed:', notesErr.message);
    }

    // 5. Merge contact tags (ignoring duplicates)
    const [sourceTagsRes, targetTagsRes] = await Promise.all([
      db.from('contact_tags').select('tag_id').eq('contact_id', sourceContactId),
      db.from('contact_tags').select('tag_id').eq('contact_id', targetContactId),
    ]);

    const sourceTags = sourceTagsRes.data || [];
    const targetTags = targetTagsRes.data || [];
    const targetTagIds = new Set(targetTags.map(tt => tt.tag_id));

    const newTagsToInsert = sourceTags
      .filter(st => !targetTagIds.has(st.tag_id))
      .map(st => ({
        contact_id: targetContactId,
        tag_id: st.tag_id
      }));

    if (newTagsToInsert.length > 0) {
      const { error: tagsInsertErr } = await db
        .from('contact_tags')
        .insert(newTagsToInsert);
      
      if (tagsInsertErr) {
        console.error('[API Merge] Contact tags merge failed:', tagsInsertErr.message);
      }
    }

    // Delete source contact tags
    await db.from('contact_tags').delete().eq('contact_id', sourceContactId);

    // 6. Log merge event to target conversation timeline
    await timelineService.logEvent({
      conversationId: targetConversationId,
      organizationId,
      eventType: 'conversation_merged',
      metadata: {
        source_conversation_id: sourceConversationId,
        source_contact_id: sourceContactId,
        source_contact_name: sourceContactName,
        merged_by: user.id
      },
      createdBy: user.id
    });

    // 7. Delete source conversation
    const { error: deleteConvErr } = await db
      .from('conversations')
      .delete()
      .eq('id', sourceConversationId);

    if (deleteConvErr) {
      console.error('[API Merge] Source conversation deletion failed:', deleteConvErr.message);
    }

    // 8. Soft-delete source contact
    const { error: deleteContactErr } = await db
      .from('contacts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', sourceContactId);

    if (deleteContactErr) {
      console.error('[API Merge] Source contact soft-deletion failed:', deleteContactErr.message);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API Conversation Merge POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
