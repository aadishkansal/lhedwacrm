// src/modules/workflows/services/inngest-engine.ts

import { inngest } from '@/core/inngest/client';
import { supabaseAdmin } from './admin-client';
import { engineSendText, engineSendTemplate } from './meta-send';
import { AIOrchestrator } from '@/modules/agents/services/orchestrator';
import { ContextManager } from '@/modules/agents/services/context-manager';
import { MemoryRetriever } from '@/modules/agents/services/memory-retriever';
import { PromptManager } from '@/modules/agents/services/prompt-manager';
import type {
  Automation,
  AutomationStep,
  WaitStepConfig,
  ConditionStepConfig,
  SendMessageStepConfig,
  SendTemplateStepConfig,
  TagStepConfig,
  AssignConversationStepConfig,
  UpdateContactFieldStepConfig,
  CreateDealStepConfig,
  SendWebhookStepConfig,
} from '@/types';

// Initialize AI tools for the engine
const orchestrator = new AIOrchestrator();
const promptManager = new PromptManager();
const contextManager = new ContextManager(new MemoryRetriever());

export const executeWorkflowInstance = inngest.createFunction(
  {
    id: 'execute-workflow-instance',
    name: 'Execute CRM Workflow Instance',
    concurrency: {
      limit: 10,
    },
    triggers: [
      { event: 'crm/workflow.trigger' }
    ]
  },
  async ({ event, step }: { event: any; step: any }) => {
    const { automationId, contactId, userId, triggerType, context } = event.data;
    const db = supabaseAdmin();

    // 1. Fetch the automation definition
    const automation = await step.run('fetch-automation', async () => {
      const { data, error } = await db
        .from('automations')
        .select('*')
        .eq('id', automationId)
        .single();
      if (error) throw new Error(`Automation ${automationId} not found: ${error.message}`);
      return data as Automation;
    });

    // 2. Create the execution log entry
    const logId = await step.run('create-execution-log', async () => {
      const { data, error } = await db
        .from('automation_logs')
        .insert({
          automation_id: automationId,
          user_id: userId,
          contact_id: contactId ?? null,
          trigger_event: triggerType,
          steps_executed: [],
          status: 'success',
        })
        .select('id')
        .single();
      if (error) throw new Error(`Failed to create log: ${error.message}`);
      return data.id as string;
    });

    // 3. Define the main workflow execution loop
    let currentPosition = 0;
    let parentStepId: string | null = null;
    let branch: 'yes' | 'no' | null = null;
    let currentContext = { ...context };

    while (true) {
      // Fetch steps matching the current scope
      const steps = await step.run(`fetch-steps-pos-${currentPosition}`, async () => {
        let query = db
          .from('automation_steps')
          .select('*')
          .eq('automation_id', automationId)
          .gte('position', currentPosition)
          .order('position', { ascending: true });

        if (parentStepId === null) {
          query = query.is('parent_step_id', null);
        } else {
          query = query.eq('parent_step_id', parentStepId).eq('branch', branch ?? 'yes');
        }

        const { data, error } = await query;
        if (error) throw new Error(`Failed to fetch steps: ${error.message}`);
        return data as AutomationStep[];
      });

      if (!steps || steps.length === 0) {
        // If we finished a sub-branch, pop back up to parent scope
        if (parentStepId !== null) {
          // Fetch parent step to see its position
          const parentStep = await step.run(`fetch-parent-${parentStepId}`, async () => {
            const { data, error } = await db
              .from('automation_steps')
              .select('*')
              .eq('id', parentStepId)
              .single();
            if (error) throw new Error(`Failed to fetch parent step: ${error.message}`);
            return data as AutomationStep;
          });
          currentPosition = parentStep.position + 1;
          parentStepId = null;
          branch = null;
          continue;
        }
        break;
      }

      let stepSuspended = false;

      for (const stepObj of steps) {
        const stepKey = `step-${stepObj.id}-${stepObj.position}`;

        // Wait suspension node
        if (stepObj.step_type === 'wait') {
          const cfg = stepObj.step_config as WaitStepConfig;
          const duration = waitDurationMs(cfg);
          
          await step.run(`log-wait-start-${stepKey}`, async () => {
            await appendStepResult(logId, {
              step_id: stepObj.id,
              step_type: stepObj.step_type,
              status: 'success',
              detail: `suspended for ${cfg.amount} ${cfg.unit}`,
            });
            await db.from('automation_logs').update({ status: 'partial' }).eq('id', logId);
          });

          await step.sleep(`sleep-${stepKey}`, duration);
          currentPosition = stepObj.position + 1;
          stepSuspended = true;
          break;
        }

        // Branching condition node
        if (stepObj.step_type === 'condition') {
          const cfg = stepObj.step_config as ConditionStepConfig;
          const taken = await step.run(`eval-condition-${stepKey}`, async () => {
            const result = await evaluateCondition(cfg, contactId, currentContext);
            await appendStepResult(logId, {
              step_id: stepObj.id,
              step_type: 'condition',
              status: 'success',
              detail: `branch=${result ? 'yes' : 'no'}`,
            });
            return result;
          });

          branch = taken ? 'yes' : 'no';
          parentStepId = stepObj.id;
          currentPosition = 0; // reset for nested scope
          stepSuspended = true;
          break;
        }

        // AI Decision / Router Node
        if (stepObj.step_type === 'ai_decision') {
          const cfg = stepObj.step_config as any; // { prompt_template_id: string, variables: string[], router_role: ModelRole }
          const decision = await step.run(`ai-decision-${stepKey}`, async () => {
            // Render prompt dynamically
            const variables: Record<string, string> = {};
            for (const v of cfg.variables || []) {
              variables[v] = String(currentContext.vars?.[v] || currentContext.message_text || '');
            }
            const prompt = promptManager.render(cfg.prompt_template_id || 'triage', variables);
            
            // Execute AI routing request
            const aiRes = await orchestrator.execute({
              role: cfg.router_role || 'triage',
              request: {
                messages: [{ role: 'user', content: prompt }]
              },
              organizationId: automation.user_id, // organization tenancy
              sessionId: logId,
              agentName: 'WorkflowDecisionAgent'
            });

            const classification = aiRes.text.trim();
            await appendStepResult(logId, {
              step_id: stepObj.id,
              step_type: 'ai_decision',
              status: 'success',
              detail: `ai_decision=${classification}`,
            });
            return classification;
          });

          // Store AI decision in vars and route branch
          currentContext.vars = {
            ...(currentContext.vars || {}),
            ai_decision: decision
          };
          branch = decision.toLowerCase() === 'no' || decision === 'OTHER' || decision === 'SUPPORT_TICKET' ? 'no' : 'yes';
          parentStepId = stepObj.id;
          currentPosition = 0;
          stepSuspended = true;
          break;
        }

        // Execute Standard CRM Actions
        try {
          const detail = await step.run(`exec-action-${stepKey}`, async () => {
            return await runActionStep(stepObj, userId, contactId, currentContext);
          });

          await step.run(`log-success-${stepKey}`, async () => {
            await appendStepResult(logId, {
              step_id: stepObj.id,
              step_type: stepObj.step_type,
              status: 'success',
              detail,
            });
          });
        } catch (err: any) {
          await step.run(`log-failure-${stepKey}`, async () => {
            await appendStepResult(logId, {
              step_id: stepObj.id,
              step_type: stepObj.step_type,
              status: 'failed',
              detail: err.message,
            });
            await db
              .from('automation_logs')
              .update({ status: 'failed', error_message: err.message })
              .eq('id', logId);
          });
          return; // halt workflow execution
        }

        currentPosition = stepObj.position + 1;
      }

      if (stepSuspended) continue;
    }

    // Finalize execution log
    await step.run('finalize-execution-log', async () => {
      const { data: existing } = await db
        .from('automation_logs')
        .select('status')
        .eq('id', logId)
        .single();
      if (existing?.status !== 'failed' && existing?.status !== 'partial') {
        await db.from('automation_logs').update({ status: 'success' }).eq('id', logId);
      }
      await db.rpc('increment_automation_execution_count', {
        p_automation_id: automationId,
      });
    });
  }
);

// ------------------------------------------------------------
// Execution Actions Helpers
// ------------------------------------------------------------

async function runActionStep(
  step: AutomationStep,
  userId: string,
  contactId: string | null,
  context: any
): Promise<string> {
  const db = supabaseAdmin();

  switch (step.step_type) {
    case 'send_message': {
      const cfg = step.step_config as SendMessageStepConfig;
      if (!contactId) throw new Error('send_message needs contact');
      const text = interpolate(cfg.text, context);
      const conversationId = await resolveConversationId(userId, contactId, context);
      const { whatsapp_message_id } = await engineSendText({
        userId,
        conversationId,
        contactId,
        text,
      });
      return `message sent (${whatsapp_message_id})`;
    }

    case 'send_template': {
      const cfg = step.step_config as SendTemplateStepConfig;
      if (!contactId) throw new Error('send_template needs contact');
      const conversationId = await resolveConversationId(userId, contactId, context);
      const params = cfg.variables
        ? Object.keys(cfg.variables)
            .sort((a, b) => Number(a) - Number(b))
            .map(k => String(cfg.variables![k]))
        : [];
      const { whatsapp_message_id } = await engineSendTemplate({
        userId,
        conversationId,
        contactId,
        templateName: cfg.template_name,
        language: cfg.language,
        params,
      });
      return `template sent (${whatsapp_message_id})`;
    }

    case 'add_tag': {
      const cfg = step.step_config as TagStepConfig;
      if (!contactId || !cfg.tag_id) throw new Error('add_tag needs contact + tag');
      await db.from('contact_tags').upsert(
        { contact_id: contactId, tag_id: cfg.tag_id },
        { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
      );
      return `tag ${cfg.tag_id} added`;
    }

    case 'remove_tag': {
      const cfg = step.step_config as TagStepConfig;
      if (!contactId || !cfg.tag_id) throw new Error('remove_tag needs contact + tag');
      await db.from('contact_tags').delete().eq('contact_id', contactId).eq('tag_id', cfg.tag_id);
      return `tag ${cfg.tag_id} removed`;
    }

    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig;
      if (!contactId) throw new Error('assign_conversation needs contact');
      let agentId = cfg.agent_id;
      if (cfg.mode === 'round_robin') {
        const { data: profiles } = await db.from('profiles').select('user_id').eq('user_id', userId).limit(1);
        agentId = profiles?.[0]?.user_id;
      }
      if (!agentId) return 'no agent resolved';
      await db.from('conversations').update({ assigned_agent_id: agentId }).eq('user_id', userId).eq('contact_id', contactId);
      return `assigned to agent ${agentId}`;
    }

    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig;
      if (!contactId) throw new Error('update_contact_field needs contact');
      await db.from('contacts').update({ [cfg.field]: cfg.value }).eq('id', contactId);
      return `${cfg.field} updated`;
    }

    case 'create_deal': {
      const cfg = step.step_config as CreateDealStepConfig;
      await db.from('deals').insert({
        user_id: userId,
        pipeline_id: cfg.pipeline_id,
        stage_id: cfg.stage_id,
        contact_id: contactId,
        title: interpolate(cfg.title, context),
        value: cfg.value ?? 0,
        status: 'open',
      });
      return 'deal created';
    }

    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig;
      const body = cfg.body_template ? interpolate(cfg.body_template, context) : JSON.stringify(context);
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.headers || {}) },
        body,
      });
      if (!res.ok) throw new Error(`webhook failed with status ${res.status}`);
      return `webhook post succeeded (${res.status})`;
    }

    case 'close_conversation': {
      if (!contactId) throw new Error('close_conversation needs contact');
      await db.from('conversations').update({ status: 'closed' }).eq('user_id', userId).eq('contact_id', contactId);
      return 'conversation closed';
    }

    default:
      throw new Error(`unknown step type: ${step.step_type}`);
  }
}

// ------------------------------------------------------------
// General helpers
// ------------------------------------------------------------

function waitDurationMs(cfg: WaitStepConfig): number {
  const unitMs = cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000;
  return Math.max(1_000, cfg.amount * unitMs);
}

async function resolveConversationId(userId: string, contactId: string, context: any): Promise<string> {
  if (context.conversation_id) return context.conversation_id;
  const { data } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .maybeSingle();
  if (!data?.id) throw new Error('no active conversation found for contact');
  return data.id as string;
}

function interpolate(s: string, context: any): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.');
    if (ns === 'message' && prop === 'text') return String(context.message_text ?? '');
    if (ns === 'vars' && prop) return String(context.vars?.[prop] ?? '');
    return '';
  });
}

async function evaluateCondition(cfg: ConditionStepConfig, contactId: string | null, context: any): Promise<boolean> {
  const db = supabaseAdmin();
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!contactId || !cfg.operand) return false;
      const { count } = await db
        .from('contact_tags')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', contactId)
        .eq('tag_id', cfg.operand);
      return (count ?? 0) > 0;
    }
    case 'contact_field': {
      if (!contactId || !cfg.operand) return false;
      const { data } = await db.from('contacts').select(cfg.operand).eq('id', contactId).maybeSingle();
      const v = (data as any)?.[cfg.operand];
      return v != null && String(v) === String(cfg.value ?? '');
    }
    case 'message_content': {
      const text = (context.message_text ?? '').toString();
      return text.toLowerCase().includes((cfg.value ?? '').toLowerCase());
    }
    default:
      return false;
  }
}

async function appendStepResult(logId: string, newResult: any) {
  const db = supabaseAdmin();
  const { data } = await db.from('automation_logs').select('steps_executed').eq('id', logId).single();
  const list = [...((data?.steps_executed as any[]) || []), newResult];
  await db.from('automation_logs').update({ steps_executed: list }).eq('id', logId);
}
