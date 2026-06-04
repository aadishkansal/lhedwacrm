import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';
import { customerContextService } from '@/modules/crm/services/customer-context-service';
import { SimilaritySearchService } from '@/modules/rag/services/similarity-service';
import { AIService } from '@/modules/agents/services/ai-service';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
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

    const db = supabaseAdmin();

    // Verify conversation membership
    const { data: conv, error: convError } = await db
      .from('conversations')
      .select('*, contact:contacts(organization_id, name, phone)')
      .eq('id', conversationId)
      .maybeSingle();

    if (convError || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const contactOrg = (conv.contact as any)?.organization_id;
    if (contactOrg !== organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 1. Fetch recent conversation transcript (last 5 messages) for short context
    const { data: dbMessages } = await db
      .from('messages')
      .select('sender_type, content_text, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(5);

    const reversedMsgs = (dbMessages || []).reverse();
    const historyText = reversedMsgs
      .map(m => `${m.sender_type === 'customer' ? 'Customer' : 'Agent'}: ${m.content_text}`)
      .join('\n');

    // Resolve the last customer query
    const lastCustomerMsg = reversedMsgs
      .slice()
      .reverse()
      .find(m => m.sender_type === 'customer');

    const lastQueryText = lastCustomerMsg?.content_text || 'General Solar Inquiry';

    // 2. Fetch customer context
    let customerContextStr = 'No customer profile context available.';
    try {
      const ctx = await customerContextService.getCustomerContextByContactId(conv.contact_id);
      customerContextStr = `Customer Profile:
- Name: ${ctx.profile.name || 'there'}
- Phone: ${ctx.profile.phone || ''}
- Active Project Stage: ${ctx.project?.status || 'none'}
- Active Deal Stage: ${ctx.lead?.status || 'none'}
- Active Quote/Proposal Size: ${ctx.proposal?.systemSizeKw || 'None'} kW, Status: ${ctx.proposal?.quoteStatus || 'None'}
- Installation Schedule: ${ctx.installation?.scheduledAt || 'None'}
- Pending Invoices: ${ctx.followups.filter(f => f.status === 'pending' && f.notes?.toLowerCase().includes('invoice')).length}`;
    } catch (err: any) {
      console.warn('[API Suggest Reply] Context retrieve failed:', err.message);
    }

    // 3. Find Knowledge Base and perform filtered similarity search (RAG)
    const { data: kb } = await db
      .from('knowledge_bases')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
      .maybeSingle();

    let ragContext = 'No relevant knowledge base documents found.';
    if (kb) {
      try {
        const similaritySearch = new SimilaritySearchService();
        const searchResults = await similaritySearch.searchDocumentChunks({
          kbId: kb.id,
          query: lastQueryText,
          threshold: 0.35, // lower threshold to capture broader hints
          limit: 3
        });

        if (searchResults && searchResults.length > 0) {
          ragContext = searchResults
            .map((chunk, index) => `[Doc ${index + 1}]\n${chunk.content}`)
            .join('\n\n');
        }
      } catch (err: any) {
        console.warn('[API Suggest Reply] Semantic search failed:', err.message);
      }
    }

    // 4. Construct System Prompt for Gemini
    const systemPrompt = `You are a RAG-powered Solar EPC Copilot. Suggest a helpful draft reply for the human agent to review, edit, and send to the customer in response to their last message.
Base your suggested reply strictly on the customer context, the provided knowledge base context, and the recent chat transcript.

Customer Context:
${customerContextStr}

Knowledge Base Context:
${ragContext}

Recent Chat Transcript:
${historyText}

Instructions:
1. Suggest a direct response to the last customer message.
2. Keep it highly professional, conversational, and concise (max 3 sentences).
3. Do NOT include placeholders like [Agent Name] or [Insert Link].
4. Output ONLY the raw suggested response text, no markdown wrappers, no formatting, no prefix/suffix text.
`;

    // 5. Generate reply suggestion via AIService (Gemini 2.5 Flash)
    const aiService = new AIService();
    const response = await aiService.generate({
      modelId: 'gemini-2.5-flash',
      systemPrompt,
      messages: [{ role: 'user', content: lastQueryText }],
      organizationId,
      sessionId: conversationId,
      agentName: 'ReplySuggestionCopilot',
      temperature: 0.2
    });

    return NextResponse.json({ suggestion: response.text.trim() });
  } catch (error: any) {
    console.error('[API Conversation Suggest Reply POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
