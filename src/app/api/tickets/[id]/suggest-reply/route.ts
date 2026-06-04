// src/app/api/tickets/[id]/suggest-reply/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';
import { ticketAIService } from '@/modules/agents/services/ticket-ai-service';
import { SimilaritySearchService } from '@/modules/rag/services/similarity-service';

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

    const admin = supabaseAdmin();
    // 1. Fetch the ticket
    const { data: ticket, error: ticketErr } = await admin
      .from('support_tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (ticketErr || !ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // 2. Fetch or build chat history
    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const body = await request.json().catch(() => ({}));
    
    if (body.history && Array.isArray(body.history)) {
      history = body.history;
    } else {
      // Resolve conversation
      const { data: conv } = await admin
        .from('conversations')
        .select('id')
        .eq('contact_id', ticket.contact_id)
        .limit(1)
        .maybeSingle();

      if (conv) {
        const { data: dbMsgs } = await admin
          .from('messages')
          .select('sender_type, content_text')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: true })
          .limit(15);

        if (dbMsgs) {
          history = dbMsgs
            .filter((m) => m.sender_type === 'customer' || m.sender_type === 'bot' || m.sender_type === 'agent')
            .map((m) => ({
              role: m.sender_type === 'customer' ? 'user' : 'assistant',
              content: m.content_text || '',
            }));
        }
      }
    }

    // 3. Query Knowledge Base for RAG context
    let kbContext = '';
    const { data: kbRow } = await admin
      .from('knowledge_bases')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
      .maybeSingle();

    if (kbRow) {
      try {
        const similaritySearch = new SimilaritySearchService();
        const matches = await similaritySearch.searchDocumentChunks({
          kbId: kbRow.id,
          query: ticket.title,
          threshold: 0.35,
          limit: 3,
        });

        if (matches && matches.length > 0) {
          const matchedIds = matches.map((m) => m.id);
          const { data: chunks } = await admin
            .from('document_chunks')
            .select('content')
            .in('id', matchedIds);

          if (chunks) {
            kbContext = chunks.map((c) => c.content).join('\n\n');
          }
        }
      } catch (ragErr: any) {
        console.warn('[API Tickets Reply RAG] RAG semantic search failed:', ragErr.message);
      }
    }

    // 4. Generate suggestion
    const suggestion = await ticketAIService.suggestReply({
      ticket,
      history,
      kbContext,
      organizationId,
      sessionId: ticketId,
    });

    return NextResponse.json({ suggestion });
  } catch (error: any) {
    console.error('[API Ticket Suggest Reply] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
