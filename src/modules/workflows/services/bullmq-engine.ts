import { Queue, Worker, Job } from 'bullmq';
import { redisConnectionOptions } from '@/lib/redis';
import { supabaseAdmin } from './admin-client';
import { engineSendText, engineSendTemplate } from './meta-send';
import { AIOrchestrator } from '@/modules/agents/services/orchestrator';
import { PromptManager } from '@/modules/agents/services/prompt-manager';
import { registry } from '@/modules/agents/tools/index';
import { ToolExecutor } from '@/modules/agents/tools/executor';
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
  AutomationStepType,
  AutomationTriggerType,
} from '@/types';

const orchestrator = new AIOrchestrator();
const promptManager = new PromptManager();

const QUEUE_NAME = 'workflow-queue';

const globalForBullMQ = global as unknown as {
  workflowQueue: Queue;
  workflowWorker: Worker;
};

// Define default job options for BullMQ (3 retries with exponential backoff)
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: true,
  removeOnFail: false,
};

export const workflowQueue =
  globalForBullMQ.workflowQueue ||
  new Queue(QUEUE_NAME, { connection: redisConnectionOptions });

if (process.env.NODE_ENV !== 'production') {
  globalForBullMQ.workflowQueue = workflowQueue;
}

/**
 * Enqueue a job from inside a worker handler using a fresh, disposable
 * Queue connection. The module-level Queue shares its connection with
 * the worker internals and throws "Connection is closed" when reused
 * from within a running job. A per-call Queue avoids this by creating
 * its own ioredis connection that is explicitly closed after the add.
 */
async function enqueueFromWorker(
  name: string,
  data: Record<string, unknown>,
  opts: typeof DEFAULT_JOB_OPTIONS & { delay?: number } = DEFAULT_JOB_OPTIONS
): Promise<void> {
  const q = new Queue(QUEUE_NAME, { connection: { ...redisConnectionOptions } });
  try {
    const job = await q.add(name, data, opts);
    console.log(`[workflows] Enqueued ${name} job ${job.id}`);
  } finally {
    await q.close();
  }
}

// ------------------------------------------------------------
// Core Worker Implementation
// ------------------------------------------------------------

export const workflowWorker =
  globalForBullMQ.workflowWorker ||
  new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const db = supabaseAdmin();

      if (job.name === 'trigger-workflow') {
        const { automationId, userId, contactId, triggerType, context, organizationId } = job.data;

        // 1. Create a workflow run in public.workflow_runs
        const { data: run, error: runErr } = await db
          .from('workflow_runs')
          .insert({
            organization_id: organizationId,
            automation_id: automationId,
            contact_id: contactId || null,
            status: 'active',
            variables: {
              vars: {},
              message_text: context.message_text || '',
              conversation_id: context.conversation_id || null,
              ...context,
            },
          })
          .select()
          .single();

        if (runErr || !run) {
          throw new Error(`Failed to create workflow run in DB: ${runErr?.message}`);
        }

        // 2. Also log to legacy automation_logs table for backward compatibility
        const { error: logErr } = await db.from('automation_logs').insert({
          id: run.id, // Align IDs so they correlate directly
          automation_id: automationId,
          user_id: userId,
          contact_id: contactId || null,
          trigger_event: triggerType,
          steps_executed: [],
          status: 'success',
        });
        if (logErr) {
          console.warn(`[workflows] Failed to create legacy audit log: ${logErr.message}`);
        }

        // 3. Queue the first step of this run
        try {
          const enqueued = await workflowQueue.add(
            'execute-step',
            {
              runId: run.id,
              currentPosition: 0,
              parentStepId: null,
              branch: null,
            },
            DEFAULT_JOB_OPTIONS
          );
          console.log(`[workflows] Enqueued execute-step job ${enqueued.id} for run ${run.id}`);
        } catch (enqErr: any) {
          console.error(`[workflows] CRITICAL: Failed to enqueue execute-step for run ${run.id}:`, enqErr.message);
          throw enqErr; // Re-throw so BullMQ retries the trigger-workflow job
        }
      }

      if (job.name === 'execute-step') {
        const { runId, currentPosition, parentStepId, branch } = job.data;

        // 1. Fetch the run state
        const { data: run, error: runErr } = await db
          .from('workflow_runs')
          .select('*')
          .eq('id', runId)
          .single();

        if (runErr || !run) {
          console.warn(`[workflows] Workflow run ${runId} not found: ${runErr?.message}`);
          return;
        }

        if (run.status !== 'active') {
          console.log(`[workflows] Workflow run ${runId} is status '${run.status}', ignoring execution step`);
          return;
        }

        // Fetch automation details to get user_id owner
        const { data: automation } = await db
          .from('automations')
          .select('user_id')
          .eq('id', run.automation_id)
          .single();

        if (!automation) {
          throw new Error(`Automation ${run.automation_id} not found`);
        }

        const userId = automation.user_id;

        // 2. Fetch steps matching the scope
        let query = db
          .from('automation_steps')
          .select('*')
          .eq('automation_id', run.automation_id)
          .gte('position', currentPosition)
          .order('position', { ascending: true });

        if (parentStepId === null) {
          query = query.is('parent_step_id', null);
        } else {
          query = query.eq('parent_step_id', parentStepId).eq('branch', branch ?? 'yes');
        }

        const { data: steps, error: stepsErr } = await query;
        if (stepsErr) throw new Error(`Failed to fetch automation steps: ${stepsErr.message}`);

        // 3. If no steps remain in this branch/scope
        if (!steps || steps.length === 0) {
          if (parentStepId !== null) {
            // Pop back up to parent scope: fetch parent step position
            const { data: parentStep, error: pErr } = await db
              .from('automation_steps')
              .select('*')
              .eq('id', parentStepId)
              .single();

            if (pErr || !parentStep) {
              throw new Error(`Failed to fetch parent step ${parentStepId}: ${pErr?.message}`);
            }

            // Enqueue resume parent scope from parentPosition + 1
            await enqueueFromWorker(
              'execute-step',
              {
                runId,
                currentPosition: parentStep.position + 1,
                parentStepId: null,
                branch: null,
              },
              DEFAULT_JOB_OPTIONS
            );
          } else {
            // Reached the end of the root steps list: Mark run completed successfully
            await db
              .from('workflow_runs')
              .update({ status: 'completed', completed_at: new Date().toISOString() })
              .eq('id', runId);

            // Update legacy logs
            await db
              .from('automation_logs')
              .update({ status: 'success' })
              .eq('id', runId);

            // Increment count atomically
            await db.rpc('increment_automation_execution_count', {
              p_automation_id: run.automation_id,
            });
          }
          return;
        }

        const currentContext = await getContextForRun(run);

        // 4. Iterate and execute steps sequentially
        for (const stepObj of steps as AutomationStep[]) {
          const stepKey = `${runId}-${stepObj.id}`;

          // Check if step was already completed in a previous attempt (for retry safety / idempotency)
          const { data: existingExec } = await db
            .from('workflow_step_executions')
            .select('*')
            .eq('run_id', runId)
            .eq('step_id', stepObj.id)
            .maybeSingle();

          if (existingExec && existingExec.status === 'completed') {
            console.log(`[workflows] Step ${stepObj.id} already completed, skipping`);

            // If it was a branch/condition/ai_decision step, we must resume downstream using cached choice
            if (stepObj.step_type === 'condition' || stepObj.step_type === 'ai_decision') {
              const selectedBranch = existingExec.output_payload?.branch;
              if (selectedBranch) {
                await enqueueFromWorker(
                  'execute-step',
                  {
                    runId,
                    currentPosition: 0,
                    parentStepId: stepObj.id,
                    branch: selectedBranch,
                  },
                  DEFAULT_JOB_OPTIONS
                );
                return; // Stop processing current scope, downstream queue job handles next
              }
            }
            continue; // Move to next step in current loop
          }

          // Step not completed, let's prepare step execution status
          let execId = existingExec?.id;
          let attemptCount = (existingExec?.attempt_count || 0) + 1;

          if (execId) {
            await db
              .from('workflow_step_executions')
              .update({ status: 'running', attempt_count: attemptCount, started_at: new Date().toISOString() })
              .eq('id', execId);
          } else {
            const { data: newExec, error: execInsErr } = await db
              .from('workflow_step_executions')
              .insert({
                organization_id: run.organization_id,
                run_id: runId,
                step_id: stepObj.id,
                status: 'running',
                attempt_count: 1,
                input_payload: { config: stepObj.step_config },
                started_at: new Date().toISOString(),
              })
              .select()
              .single();

            if (execInsErr || !newExec) {
              throw new Error(`Failed to log step execution starting: ${execInsErr?.message}`);
            }
            execId = newExec.id;
          }

          try {
            // Executing Wait step
            if (stepObj.step_type === 'wait') {
              const cfg = stepObj.step_config as WaitStepConfig;
              const duration = waitDurationMs(cfg);

              // Update step execution as completed with wait details
              await db
                .from('workflow_step_executions')
                .update({
                  status: 'completed',
                  output_payload: { status: 'suspended', durationMs: duration },
                  finished_at: new Date().toISOString(),
                })
                .eq('id', execId);

              // Update overall run status to partial / pending wait (optional, let's keep active)
              await db
                .from('automation_logs')
                .update({ status: 'partial' })
                .eq('id', runId);

              await appendLegacyStepResult(runId, {
                step_id: stepObj.id,
                step_type: stepObj.step_type,
                status: 'success',
                detail: `suspended for ${cfg.amount} ${cfg.unit}`,
              });

              // Add a delayed job to resume workflow run at position + 1
              await enqueueFromWorker(
                'execute-step',
                {
                  runId,
                  currentPosition: stepObj.position + 1,
                  parentStepId,
                  branch,
                },
                {
                  ...DEFAULT_JOB_OPTIONS,
                  delay: duration,
                }
              );
              return; // Stop executing right now
            }

            // Executing Condition step
            if (stepObj.step_type === 'condition') {
              const cfg = stepObj.step_config as ConditionStepConfig;
              const result = await evaluateCondition(cfg, run.contact_id, currentContext);
              const branchResult = result ? 'yes' : 'no';

              await db
                .from('workflow_step_executions')
                .update({
                  status: 'completed',
                  output_payload: { branch: branchResult },
                  finished_at: new Date().toISOString(),
                })
                .eq('id', execId);

              await appendLegacyStepResult(runId, {
                step_id: stepObj.id,
                step_type: 'condition',
                status: 'success',
                detail: `branch=${branchResult}`,
              });

              // Trigger branching execute-step job
              await enqueueFromWorker(
                'execute-step',
                {
                  runId,
                  currentPosition: 0,
                  parentStepId: stepObj.id,
                  branch: branchResult,
                },
                DEFAULT_JOB_OPTIONS
              );
              return; // Downstream job handles execution
            }

            // Executing AI Decision step
            if (stepObj.step_type === 'ai_decision') {
              const cfg = stepObj.step_config as any; // { prompt_template_id, variables: string[], router_role }
              const variables: Record<string, string> = {};
              for (const v of cfg.variables || []) {
                variables[v] = String(currentContext.vars?.[v] || currentContext.message_text || '');
              }
              const prompt = promptManager.render(cfg.prompt_template_id || 'triage', variables);

              const aiRes = await orchestrator.execute({
                role: cfg.router_role || 'triage',
                request: {
                  messages: [{ role: 'user', content: prompt }],
                },
                organizationId: run.organization_id,
                sessionId: runId,
                agentName: 'WorkflowDecisionAgent',
              });

              const decision = aiRes.text.trim();
              const branchResult =
                decision.toLowerCase() === 'no' || decision === 'OTHER' || decision === 'SUPPORT_TICKET'
                  ? 'no'
                  : 'yes';

              // Store decision in run variables
              const updatedVars = {
                ...(run.variables || {}),
                vars: {
                  ...(run.variables?.vars || {}),
                  ai_decision: decision,
                },
              };

              await db
                .from('workflow_runs')
                .update({ variables: updatedVars })
                .eq('id', runId);

              await db
                .from('workflow_step_executions')
                .update({
                  status: 'completed',
                  output_payload: { branch: branchResult, ai_decision: decision },
                  finished_at: new Date().toISOString(),
                })
                .eq('id', execId);

              await appendLegacyStepResult(runId, {
                step_id: stepObj.id,
                step_type: 'ai_decision',
                status: 'success',
                detail: `ai_decision=${decision}`,
              });

              await enqueueFromWorker(
                'execute-step',
                {
                  runId,
                  currentPosition: 0,
                  parentStepId: stepObj.id,
                  branch: branchResult,
                },
                DEFAULT_JOB_OPTIONS
              );
              return;
            }

            // Executing Tool Call step
            if (stepObj.step_type === 'tool_call') {
              const cfg = stepObj.step_config as any; // { tool_name, arguments }
              const rawArgs = cfg.arguments || {};
              const args: Record<string, any> = {};

              // Interpolate arguments mapping
              for (const [key, val] of Object.entries(rawArgs)) {
                if (typeof val === 'string') {
                  args[key] = interpolate(val, currentContext);
                } else {
                  args[key] = val;
                }
              }

              const tool = registry.get(cfg.tool_name);
              if (!tool) throw new Error(`Tool "${cfg.tool_name}" not found in registry`);

              const executor = new ToolExecutor();
              const toolContext = {
                organizationId: run.organization_id,
                userId: run.organization_id, // Organization tenancy
                userRole: 'admin', // Bypass checks during automation
                sessionId: runId,
              };

              const toolRes = await executor.execute(tool, args, toolContext);
              if (!toolRes.success) {
                throw new Error(`Tool execution failed: ${toolRes.error}`);
              }

              // Store output payload
              const updatedVars = {
                ...(run.variables || {}),
                vars: {
                  ...(run.variables?.vars || {}),
                  [cfg.tool_name]: toolRes.data,
                  tool_result: toolRes.data,
                },
              };

              await db
                .from('workflow_runs')
                .update({ variables: updatedVars })
                .eq('id', runId);

              await db
                .from('workflow_step_executions')
                .update({
                  status: 'completed',
                  output_payload: { result: toolRes.data },
                  finished_at: new Date().toISOString(),
                })
                .eq('id', execId);

              await appendLegacyStepResult(runId, {
                step_id: stepObj.id,
                step_type: 'tool_call',
                status: 'success',
                detail: `tool ${cfg.tool_name} executed successfully`,
              });

              // Dynamically refresh context in variable bindings
              currentContext.vars = updatedVars.vars;
            } else {
              // Executing standard CRM Action step
              const detail = await runActionStep(stepObj, userId, run.contact_id, currentContext);

              await db
                .from('workflow_step_executions')
                .update({
                  status: 'completed',
                  output_payload: { result: detail },
                  finished_at: new Date().toISOString(),
                })
                .eq('id', execId);

              await appendLegacyStepResult(runId, {
                step_id: stepObj.id,
                step_type: stepObj.step_type,
                status: 'success',
                detail,
              });
            }
          } catch (err: any) {
            // Update step execution as failed
            const errMsg = err.message || String(err);
            await db
              .from('workflow_step_executions')
              .update({
                status: 'failed',
                error_message: errMsg,
                finished_at: new Date().toISOString(),
              })
              .eq('id', execId);

            await appendLegacyStepResult(runId, {
              step_id: stepObj.id,
              step_type: stepObj.step_type,
              status: 'failed',
              detail: errMsg,
            });

            // If job exceeds maximum retries, fail the run
            if (job.attemptsMade + 1 >= (job.opts.attempts || 3)) {
              await db
                .from('workflow_runs')
                .update({ status: 'failed' })
                .eq('id', runId);

              await db
                .from('automation_logs')
                .update({ status: 'failed', error_message: errMsg })
                .eq('id', runId);
            }

            // Propagate error to trigger BullMQ's automatic retry
            throw err;
          }
        }

        // If we finished the loop without early returning (e.g. wait or condition branch),
        // we have completed all steps in this scope.
        if (parentStepId !== null) {
          // Pop back up to parent scope: fetch parent step position
          const { data: parentStep, error: pErr } = await db
            .from('automation_steps')
            .select('*')
            .eq('id', parentStepId)
            .single();

          if (pErr || !parentStep) {
            throw new Error(`Failed to fetch parent step ${parentStepId}: ${pErr?.message}`);
          }

          // Enqueue resume parent scope from parentPosition + 1
          await enqueueFromWorker(
            'execute-step',
            {
              runId,
              currentPosition: parentStep.position + 1,
              parentStepId: null,
              branch: null,
            },
            DEFAULT_JOB_OPTIONS
          );
        } else {
          // Reached the end of the root steps list: Mark run completed successfully
          console.log(`[workflows] Reached end of root steps list for run ${runId}. Updating status to completed.`);
          const { data: updateData, error: updateErr } = await db
            .from('workflow_runs')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', runId)
            .select();

          if (updateErr) {
            console.error(`[workflows] Failed to update workflow run status for run ${runId}:`, updateErr.message);
          } else {
            console.log(`[workflows] Successfully updated workflow run status to completed for run ${runId}:`, updateData);
          }

          // Update legacy logs
          const { error: logErr } = await db
            .from('automation_logs')
            .update({ status: 'success' })
            .eq('id', runId);
          if (logErr) {
            console.error(`[workflows] Failed to update legacy log status for run ${runId}:`, logErr.message);
          }

          // Increment count atomically
          const { error: rpcErr } = await db.rpc('increment_automation_execution_count', {
            p_automation_id: run.automation_id,
          });
          if (rpcErr) {
            console.error(`[workflows] Failed to increment automation execution count:`, rpcErr.message);
          }
        }
      }
    },
    { connection: redisConnectionOptions, concurrency: 5 }
  );

if (process.env.NODE_ENV !== 'production') {
  globalForBullMQ.workflowWorker = workflowWorker;
}

// ------------------------------------------------------------
// Execution Action Runner Helpers
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
            .map((k) => String(cfg.variables![k]))
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
// Helpers
// ------------------------------------------------------------

function waitDurationMs(cfg: WaitStepConfig): number {
  const unitMs = cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000;
  return Math.max(1000, cfg.amount * unitMs);
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
    if (ns === 'contact' && prop) return String(context.contact?.[prop] ?? '');
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

async function getContextForRun(run: any) {
  const db = supabaseAdmin();
  let contact = null;
  if (run.contact_id) {
    const { data } = await db
      .from('contacts')
      .select('*')
      .eq('id', run.contact_id)
      .maybeSingle();
    contact = data;
  }
  return {
    contact,
    vars: run.variables?.vars || {},
    message_text: run.variables?.message_text || '',
    conversation_id: run.variables?.conversation_id || null,
    ...run.variables,
  };
}

async function appendLegacyStepResult(logId: string, newResult: any) {
  const db = supabaseAdmin();
  const { data } = await db.from('automation_logs').select('steps_executed').eq('id', logId).single();
  const list = [...((data?.steps_executed as any[]) || []), newResult];
  await db.from('automation_logs').update({ steps_executed: list }).eq('id', logId);
}
