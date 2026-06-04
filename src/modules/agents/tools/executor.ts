// src/modules/agents/tools/executor.ts

import { AgentTool, ToolContext, ToolExecutionResult } from './types';
import { supabaseAdmin } from '../../workflows/services/admin-client';

import { randomUUID } from 'crypto';

export class ToolExecutor {
  /**
   * Executes a tool with input validation, permission checks, retry handling, and database logging.
   */
  async execute<I, O>(
    tool: AgentTool<I, O>,
    args: I,
    context: ToolContext
  ): Promise<ToolExecutionResult<O>> {
    const startTime = Date.now();
    let attempts = 0;
    let success = false;
    let data: O | undefined;
    let error: string | undefined;

    // 1. Validation Layer (handled via Zod schema)
    try {
      tool.schema.parse(args);
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const validationError = `Validation failed: ${err.message || JSON.stringify(err)}`;
      
      const result: ToolExecutionResult<O> = {
        success: false,
        error: validationError,
        durationMs,
        attempts: 0,
      };

      await this.logExecution(tool, args, result, context).catch(console.error);
      return result;
    }

    // 2. Permission Layer
    const hasPermission = this.checkPermissions(tool, context);
    if (!hasPermission) {
      const durationMs = Date.now() - startTime;
      const permError = `Permission denied. Required permissions: ${tool.permissions.join(', ')}`;
      
      const result: ToolExecutionResult<O> = {
        success: false,
        error: permError,
        durationMs,
        attempts: 0,
      };

      await this.logExecution(tool, args, result, context).catch(console.error);
      return result;
    }

    // 3. Execution Layer with Retry Handling
    const retryConfig = tool.retryConfig || {};
    const maxAttempts = retryConfig.maxAttempts ?? 3;
    const initialDelayMs = retryConfig.initialDelayMs ?? 300;
    const backoffFactor = retryConfig.backoffFactor ?? 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        data = await tool.handler(args, context);
        success = true;
        error = undefined;
        break;
      } catch (err: any) {
        error = err.message || 'Unknown error occurred during tool execution';
        if (attempts >= maxAttempts) {
          break;
        }
        const delay = initialDelayMs * Math.pow(backoffFactor, attempts - 1);
        console.warn(`[ToolExecutor] Attempt ${attempts} failed for tool "${tool.name}". Retrying in ${delay}ms. Error: ${error}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const durationMs = Date.now() - startTime;
    const result: ToolExecutionResult<O> = {
      success,
      data,
      error,
      durationMs,
      attempts,
    };

    // 4. Logging Layer
    await this.logExecution(tool, args, result, context).catch(e => {
      console.error('[ToolExecutor] Logging to Supabase failed:', e.message);
    });

    return result;
  }

  /**
   * Evaluates permissions on the executing context.
   */
  private checkPermissions(tool: AgentTool, context: ToolContext): boolean {
    if (!tool.permissions || tool.permissions.length === 0) {
      return true;
    }

    // Admins bypass all permission checks
    if (context.userRole === 'admin') {
      return true;
    }

    const userPerms = context.userPermissions || [];
    return tool.permissions.every(p => userPerms.includes(p));
  }

  /**
   * Logs execution metrics and results to Supabase.
   */
  private async logExecution(
    tool: AgentTool,
    args: any,
    result: ToolExecutionResult,
    context: ToolContext
  ): Promise<void> {
    const admin = supabaseAdmin();
    const execId = await this.ensureExecutionParent(context, tool.name);

    const { error } = await admin
      .from('agent_tool_calls')
      .insert({
        execution_id: execId,
        tool_name: tool.name,
        arguments: args,
        result: result.success ? (result.data || {}) : null,
        status: result.success ? 'success' : 'failure',
        error_message: result.error || null,
        duration_ms: result.durationMs,
      });

    if (error) {
      throw error;
    }
  }

  /**
   * Returns a valid parent execution_id, creating one if not present in the context.
   */
  private async ensureExecutionParent(context: ToolContext, toolName: string): Promise<string> {
    if (context.executionId) {
      return context.executionId;
    }

    let sessionId = context.sessionId;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!sessionId || !uuidRegex.test(sessionId)) {
      sessionId = randomUUID();
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from('agent_executions')
      .insert({
        organization_id: context.organizationId,
        session_id: sessionId,
        agent_name: `${toolName}-Runner`,
        status: 'completed',
        prompt_tokens: 0,
        completion_tokens: 0,
        duration_ms: 0,
        model_used: 'tool-executor',
        provider: 'local',
        prompt_cost: 0,
        completion_cost: 0,
        total_cost: 0,
      })
      .select('id')
      .single();

    if (error || !data) {
      console.error('Failed to create fallback execution parent for tool logs:', error?.message);
      throw new Error(`Execution parent creation failed: ${error?.message}`);
    }

    context.executionId = data.id;
    return data.id;
  }
}
