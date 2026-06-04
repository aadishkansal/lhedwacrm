import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';
import { timelineService } from '@/modules/agents/services/timeline-service';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: contactId } = await params;
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

    // Verify contact belongs to organization
    const db = supabaseAdmin();
    const { data: contact, error: contactError } = await db
      .from('contacts')
      .select('id, organization_id')
      .eq('id', contactId)
      .maybeSingle();

    if (contactError || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    if (contact.organization_id !== organizationId) {
      return NextResponse.json({ error: 'Forbidden: Contact outside organization' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    let tagId = body.tagId;

    // If tagId is not provided, check if we want to create a new tag on the fly
    if (!tagId && body.name) {
      const tagName = body.name.trim();
      const tagColor = body.color || '#3b82f6';

      // Verify if tag already exists in organization
      const { data: existingTag } = await db
        .from('tags')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('name', tagName)
        .maybeSingle();

      if (existingTag) {
        tagId = existingTag.id;
      } else {
        // Create new organization-wide tag
        const { data: newTag, error: createTagErr } = await db
          .from('tags')
          .insert({
            organization_id: organizationId,
            user_id: user.id,
            name: tagName,
            color: tagColor,
          })
          .select('id')
          .single();

        if (createTagErr) {
          return NextResponse.json({ error: `Failed to create tag: ${createTagErr.message}` }, { status: 500 });
        }
        tagId = newTag.id;
      }
    }

    if (!tagId) {
      return NextResponse.json({ error: 'tagId or tag name is required' }, { status: 400 });
    }

    // Link contact and tag
    const { error: linkError } = await db
      .from('contact_tags')
      .insert({
        contact_id: contactId,
        tag_id: tagId,
      });

    if (linkError && linkError.code !== '23505') { // Ignore duplicate key errors (tag already linked)
      return NextResponse.json({ error: linkError.message }, { status: 500 });
    }

    // Get tag details for timeline log
    const { data: tagData } = await db
      .from('tags')
      .select('name, color')
      .eq('id', tagId)
      .single();

    const tagName = tagData?.name || 'Tag';

    // Check if there is an active conversation to log the timeline event
    const { data: conv } = await db
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
      .limit(1)
      .maybeSingle();

    if (conv) {
      await timelineService.logEvent({
        conversationId: conv.id,
        organizationId,
        eventType: 'tag_added',
        metadata: {
          tag_id: tagId,
          tag_name: tagName,
          added_by: user.id,
        },
        createdBy: user.id,
      });
    }

    return NextResponse.json({ success: true, tagId, tagName });
  } catch (error: any) {
    console.error('[API Contact Tags POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: contactId } = await params;
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

    const url = new URL(request.url);
    const tagId = url.searchParams.get('tagId');

    if (!tagId) {
      return NextResponse.json({ error: 'tagId query parameter is required' }, { status: 400 });
    }

    const db = supabaseAdmin();

    // Verify contact belongs to organization
    const { data: contact } = await db
      .from('contacts')
      .select('id, organization_id')
      .eq('id', contactId)
      .maybeSingle();

    if (!contact || contact.organization_id !== organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get tag details for timeline log
    const { data: tagData } = await db
      .from('tags')
      .select('name')
      .eq('id', tagId)
      .single();

    const tagName = tagData?.name || 'Tag';

    // Delete link
    const { error: unlinkError } = await db
      .from('contact_tags')
      .delete()
      .eq('contact_id', contactId)
      .eq('tag_id', tagId);

    if (unlinkError) {
      return NextResponse.json({ error: unlinkError.message }, { status: 500 });
    }

    // Check if there is an active conversation to log the timeline event
    const { data: conv } = await db
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
      .limit(1)
      .maybeSingle();

    if (conv) {
      await timelineService.logEvent({
        conversationId: conv.id,
        organizationId,
        eventType: 'tag_removed',
        metadata: {
          tag_id: tagId,
          tag_name: tagName,
          removed_by: user.id,
        },
        createdBy: user.id,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API Contact Tags DELETE] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
