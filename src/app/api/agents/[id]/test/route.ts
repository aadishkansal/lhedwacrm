import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';
import { customerContextService } from '@/modules/crm';
import { PromptBuilder } from '@/modules/agents/services/prompt-builder';
import { ModelRegistry } from '@/modules/agents/services/model-registry';
import { registry } from '@/modules/agents/tools';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Resolve organization membership
    const { data: orgUser, error: orgError } = await supabaseAdmin()
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

    // Fetch existing agent configuration
    const admin = supabaseAdmin();
    const { data: agent, error: agentError } = await admin
      .from('agent_configs')
      .select('*')
      .eq('id', agentId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (agentError) {
      return NextResponse.json({ error: agentError.message }, { status: 500 });
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !body.message) {
      return NextResponse.json({ error: 'message is required in the body' }, { status: 400 });
    }

    const testPrompt = body.systemPrompt !== undefined ? body.systemPrompt : agent.system_prompt;
    const testModel = body.model || agent.model || 'gemini-2.5-flash';
    const testTemperature = body.temperature !== undefined ? Number(body.temperature) : Number(agent.temperature);
    const testAllowedTools = body.allowedTools || agent.allowed_tools || [];

    // Fetch first contact for organization to act as sandbox customer context
    const { data: firstContact } = await admin
      .from('contacts')
      .select('id, phone')
      .eq('organization_id', organizationId)
      .limit(1)
      .maybeSingle();

    let customerContext: any = null;
    if (firstContact) {
      try {
        customerContext = await customerContextService.getCustomerContextByContactId(firstContact.id);
      } catch (err) {
        console.warn('[API Agent Test] Failed to load contact context:', err);
      }
    }

    if (!customerContext) {
      // Fallback fallback dummy context
      customerContext = {
        profile: { id: 'dummy-id', name: 'Sandbox Client', phone: '+15555555555', email: 'sandbox@solar.com', company: 'Sandbox Corp' },
        lead: { status: 'nurturing', budget: '$15,000', requirements: '6kW Roof Panels' },
        conversion: { isConverted: false },
        proposal: { systemSizeKw: '6', totalAmount: 14500, quoteStatus: 'sent' },
        project: { projectId: 'project-sandbox', status: 'installation' },
        installation: { slotId: 'slot-sandbox', scheduledAt: new Date(Date.now() + 86400000 * 3).toISOString() }, // 3 days out
        followups: [
          { status: 'pending', notes: 'Send net metering invoice' }
        ],
        documents: [],
      };
    }

    // Interpolate system prompt
    const interpolatedPrompt = PromptBuilder.buildPrompt(testPrompt, {
      customerContext,
      messageText: body.message,
    });

    // Resolve model adapter
    const modelMetadata = ModelRegistry.getModel(testModel);
    let providerModel;
    if (modelMetadata.provider === 'openai') {
      providerModel = openai(modelMetadata.id);
    } else if (modelMetadata.provider === 'google' || modelMetadata.provider === 'gemini') {
      providerModel = google(modelMetadata.id);
    } else {
      return NextResponse.json({ error: `Unsupported provider: ${modelMetadata.provider}` }, { status: 400 });
    }

    // Resolve sandbox tools execution
    const toolContext = {
      organizationId,
      userId: user.id,
      userRole: 'bot',
      sessionId: 'prompt-test-session',
    };
    const testTools = registry.toSDKTools(toolContext, testAllowedTools);

    // Call LLM sandbox with max 5 steps loop
    const { text, toolCalls } = await generateText({
      model: providerModel,
      system: interpolatedPrompt,
      messages: [{ role: 'user', content: body.message }],
      tools: testTools,
      maxSteps: 5,
      temperature: testTemperature,
    } as any);

    return NextResponse.json({
      text: text || '',
      toolCalls: toolCalls || [],
      interpolatedPrompt,
      contextUsed: {
        customerName: customerContext.profile.name,
        customerPhone: customerContext.profile.phone,
      }
    });
  } catch (error: any) {
    console.error('[API Agent Test] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
