// src/app/api/tickets/[id]/comments/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const ticketId = resolvedParams.id;
    if (!ticketId) {
      return NextResponse.json({ error: 'Ticket ID is required' }, { status: 400 });
    }

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

    const admin = supabaseAdmin();
    const { data: comments, error: fetchError } = await admin
      .from('ticket_comments')
      .select('*')
      .eq('ticket_id', ticketId)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true });

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    // Populate author profile details safely in JS
    const authorIds = Array.from(new Set((comments || []).map((c) => c.author_id).filter(Boolean)));
    let profilesMap: Record<string, any> = {};

    if (authorIds.length > 0) {
      const { data: profiles, error: profilesErr } = await admin
        .from('profiles')
        .select('user_id, full_name, avatar_url')
        .in('user_id', authorIds);

      if (!profilesErr && profiles) {
        profiles.forEach((p) => {
          profilesMap[p.user_id] = p;
        });
      }
    }

    const commentsWithAuthor = (comments || []).map((comment) => ({
      ...comment,
      author: comment.author_id ? profilesMap[comment.author_id] || null : null,
    }));

    return NextResponse.json({ comments: commentsWithAuthor });
  } catch (error: any) {
    console.error('[API Ticket Comments GET] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const ticketId = resolvedParams.id;
    if (!ticketId) {
      return NextResponse.json({ error: 'Ticket ID is required' }, { status: 400 });
    }

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

    const body = await request.json();
    const { content, isInternal } = body;

    if (!content || !content.trim()) {
      return NextResponse.json({ error: 'Comment content is required' }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: comment, error: insertError } = await admin
      .from('ticket_comments')
      .insert({
        ticket_id: ticketId,
        organization_id: organizationId,
        author_id: user.id,
        content: content.trim(),
        is_internal: isInternal !== undefined ? isInternal : true,
      })
      .select()
      .single();

    if (insertError || !comment) {
      return NextResponse.json({ error: insertError?.message || 'Failed to add comment' }, { status: 500 });
    }

    // Fetch author profile
    const { data: profile } = await admin
      .from('profiles')
      .select('user_id, full_name, avatar_url')
      .eq('user_id', user.id)
      .maybeSingle();

    const commentWithAuthor = {
      ...comment,
      author: profile || null,
    };

    return NextResponse.json({ comment: commentWithAuthor });
  } catch (error: any) {
    console.error('[API Ticket Comments POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
