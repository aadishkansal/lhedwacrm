// src/modules/agents/services/usage-tracker.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { ModelRegistry } from './model-registry';

export interface UsageLogInput {
  organizationId: string;
  sessionId: string;
  agentName: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  status: 'completed' | 'failed';
  errorMessage?: string;
  toolCalls?: Array<{
    name: string;
    arguments: any;
    result: any;
    durationMs: number;
  }>;
}

export class UsageTracker {
  static calculateCost(modelId: string, promptTokens: number, completionTokens: number) {
    try {
      const metadata = ModelRegistry.getModel(modelId);
      const promptCost = (promptTokens / 1_000_000) * metadata.inputTokenCostPerMillion;
      const completionCost = (completionTokens / 1_000_000) * metadata.outputTokenCostPerMillion;
      const totalCost = promptCost + completionCost;
      return { promptCost, completionCost, totalCost, provider: metadata.provider };
    } catch {
      // Fallback cost calculation if model not in registry
      return { promptCost: 0, completionCost: 0, totalCost: 0, provider: 'unknown' };
    }
  }

  static async logUsage(input: UsageLogInput): Promise<string> {
    const { promptCost, completionCost, totalCost, provider } = this.calculateCost(
      input.modelId,
      input.promptTokens,
      input.completionTokens
    );

    const admin = supabaseAdmin();
    const { data: exec, error: execError } = await admin
      .from('agent_executions')
      .insert({
        organization_id: input.organizationId,
        session_id: input.sessionId,
        agent_name: input.agentName,
        status: input.status,
        prompt_tokens: input.promptTokens,
        completion_tokens: input.completionTokens,
        duration_ms: input.durationMs,
        error_message: input.errorMessage || null,
        prompt_cost: promptCost,
        completion_cost: completionCost,
        total_cost: totalCost,
        model_used: input.modelId,
        provider: provider
      })
      .select('id')
      .single();

    if (execError || !exec) {
      console.error('Failed to log agent execution usage:', execError?.message);
      throw new Error(`Usage logging failed: ${execError?.message}`);
    }

    if (input.toolCalls && input.toolCalls.length > 0) {
      const toolRecords = input.toolCalls.map(tc => ({
        execution_id: exec.id,
        tool_name: tc.name,
        arguments: tc.arguments,
        result: tc.result || {},
        duration_ms: tc.durationMs
      }));

      const { error: toolError } = await admin.from('agent_tool_calls').insert(toolRecords);
      if (toolError) {
        console.error('Failed to log agent tool calls usage:', toolError.message);
      }
    }

    return exec.id;
  }
}
