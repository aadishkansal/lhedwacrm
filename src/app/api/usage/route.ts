import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/modules/workflows/services/admin-client';

function getCountryCode(phone: string | null): string {
  if (!phone) return 'default';
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.startsWith('91')) return 'IN';
  if (clean.startsWith('1') && clean.length === 11) return 'US';
  if (clean.startsWith('44')) return 'UK';
  if (clean.startsWith('55')) return 'BR';
  if (clean.startsWith('52')) return 'MX';
  return 'default';
}

function estimateWhatsAppCost(
  contentType: string,
  templateName: string | null,
  phone: string | null,
  templateCategoryMap: Record<string, string>
): number {
  if (contentType !== 'template' || !templateName) return 0;

  // Resolve category
  let category = 'Marketing';
  const nameLower = templateName.toLowerCase();
  if (templateCategoryMap[templateName]) {
    category = templateCategoryMap[templateName];
  } else if (nameLower.includes('otp') || nameLower.includes('auth') || nameLower.includes('verification')) {
    category = 'Authentication';
  } else if (
    nameLower.includes('confirm') ||
    nameLower.includes('update') ||
    nameLower.includes('alert') ||
    nameLower.includes('reminder') ||
    nameLower.includes('visit') ||
    nameLower.includes('slot')
  ) {
    category = 'Utility';
  }

  // Resolve country code
  const country = getCountryCode(phone);

  // Rate card (estimated USD per message based on Meta WhatsApp Platform Pricing)
  const rates: Record<string, { Marketing: number; Utility: number; Authentication: number }> = {
    IN: { Marketing: 0.0099, Utility: 0.0015, Authentication: 0.0015 },
    US: { Marketing: 0.015, Utility: 0.01, Authentication: 0.0135 },
    UK: { Marketing: 0.045, Utility: 0.03, Authentication: 0.035 },
    BR: { Marketing: 0.065, Utility: 0.04, Authentication: 0.05 },
    MX: { Marketing: 0.04, Utility: 0.025, Authentication: 0.03 },
    default: { Marketing: 0.035, Utility: 0.02, Authentication: 0.025 },
  };

  const countryRates = rates[country] || rates.default;
  return countryRates[category as 'Marketing' | 'Utility' | 'Authentication'] || 0.035;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = supabaseAdmin();
    const { data: orgUser, error: orgError } = await admin
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

    // 1. Fetch LLM usage stats (agent_executions)
    const { data: executions, error: execError } = await admin
      .from('agent_executions')
      .select('total_cost, prompt_tokens, completion_tokens, model_used, provider, status, created_at')
      .eq('organization_id', organizationId);

    if (execError) {
      return NextResponse.json({ error: execError.message }, { status: 500 });
    }

    // 2. Fetch WhatsApp config details (to show phone limits)
    const { data: whatsappConfig } = await admin
      .from('whatsapp_config')
      .select('phone_number_id, status, waba_id')
      .eq('user_id', user.id)
      .maybeSingle();

    // 3. Fetch template categories to map exact billing costs
    const { data: dbTemplates } = await admin
      .from('message_templates')
      .select('name, category')
      .eq('user_id', user.id);

    const templateCategoryMap: Record<string, string> = {};
    if (dbTemplates) {
      dbTemplates.forEach(t => {
        templateCategoryMap[t.name] = t.category;
      });
    }

    // 4. Fetch WhatsApp Message logs and calculate billing estimates
    const { data: contacts, error: contactsError } = await admin
      .from('contacts')
      .select('id, phone')
      .eq('organization_id', organizationId);
      
    let messagesCount = {
      total: 0,
      customer: 0,
      agent: 0,
      bot: 0,
      templates: 0,
    };

    let whatsappCost = {
      totalEstimatedCost: 0,
      billingCycleCost: 0, // current calendar month
    };

    if (!contactsError && contacts && contacts.length > 0) {
      const contactIds = contacts.map(c => c.id);
      const contactMap = new Map<string, string>();
      contacts.forEach(c => {
        if (c.phone) contactMap.set(c.id, c.phone);
      });
      
      const { data: convs } = await admin
        .from('conversations')
        .select('id, contact_id')
        .in('contact_id', contactIds);
        
      if (convs && convs.length > 0) {
        const convIds = convs.map(c => c.id);
        const convContactMap = new Map<string, string>();
        convs.forEach(c => {
          convContactMap.set(c.id, c.contact_id);
        });
        
        const { data: msgStats } = await admin
          .from('messages')
          .select('sender_type, content_type, template_name, created_at, conversation_id')
          .in('conversation_id', convIds);
          
        if (msgStats) {
          const now = new Date();
          const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

          messagesCount.total = msgStats.length;
          msgStats.forEach(m => {
            if (m.sender_type === 'customer') messagesCount.customer++;
            else if (m.sender_type === 'agent') messagesCount.agent++;
            else if (m.sender_type === 'bot') messagesCount.bot++;
            
            if (m.content_type === 'template') {
              messagesCount.templates++;
              const contactId = convContactMap.get(m.conversation_id);
              const phone = contactId ? contactMap.get(contactId) || null : null;
              
              const cost = estimateWhatsAppCost(
                m.content_type,
                m.template_name,
                phone,
                templateCategoryMap
              );

              whatsappCost.totalEstimatedCost += cost;
              if (m.created_at && new Date(m.created_at) >= firstDayOfMonth) {
                whatsappCost.billingCycleCost += cost;
              }
            }
          });
        }
      }
    }

    // Process LLM statistics
    let llmStats = {
      totalExecutions: 0,
      failedExecutions: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      byModel: {} as Record<string, { promptTokens: number; completionTokens: number; cost: number; count: number; provider: string }>,
    };

    if (executions) {
      llmStats.totalExecutions = executions.length;
      executions.forEach(e => {
        if (e.status === 'failed') llmStats.failedExecutions++;
        llmStats.totalPromptTokens += e.prompt_tokens || 0;
        llmStats.totalCompletionTokens += e.completion_tokens || 0;
        llmStats.totalCost += e.total_cost || 0;

        const model = e.model_used || 'unknown';
        if (!llmStats.byModel[model]) {
          llmStats.byModel[model] = {
            promptTokens: 0,
            completionTokens: 0,
            cost: 0,
            count: 0,
            provider: e.provider || 'unknown',
          };
        }
        llmStats.byModel[model].promptTokens += e.prompt_tokens || 0;
        llmStats.byModel[model].completionTokens += e.completion_tokens || 0;
        llmStats.byModel[model].cost += e.total_cost || 0;
        llmStats.byModel[model].count++;
      });
    }

    return NextResponse.json({
      whatsapp: {
        config: whatsappConfig ? {
          phone_number_id: whatsappConfig.phone_number_id,
          waba_id: whatsappConfig.waba_id,
          status: whatsappConfig.status,
          messaging_limit: 'Tier 1 (1,000 unique recipients / 24h)',
        } : null,
        stats: messagesCount,
        cost: whatsappCost,
      },
      llm: llmStats,
    });
  } catch (error: any) {
    console.error('[API Usage GET] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
