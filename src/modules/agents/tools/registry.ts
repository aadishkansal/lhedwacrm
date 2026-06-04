// src/modules/agents/tools/registry.ts

import { AgentTool, ToolContext } from './types';
import { tool as sdkTool } from 'ai';
import { ToolExecutor } from './executor';

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools = new Map<string, AgentTool>();

  private constructor() {}

  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * Register a new tool in the framework.
   */
  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool "${tool.name}" is already registered. Overwriting.`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Retrieve a tool by its name.
   */
  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools.
   */
  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Clears all registered tools (mainly for testing).
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Converts all registered tools (or a list of filtered tools) into Vercel AI SDK tool format,
   * injecting permissions checks, retry handling, validation, and logging via ToolExecutor.
   */
  toSDKTools(context: ToolContext, toolNames?: string[]): Record<string, any> {
    const sdkTools: Record<string, any> = {};
    const toolsToExport = toolNames 
      ? toolNames.map(name => this.get(name)).filter((t): t is AgentTool => !!t)
      : this.getAll();

    for (const agentTool of toolsToExport) {
      sdkTools[agentTool.name] = sdkTool({
        description: agentTool.description,
        parameters: agentTool.schema as any,
        execute: async (args: any) => {
          const executor = new ToolExecutor();
          const result = await executor.execute(agentTool, args, context);
          if (!result.success) {
            // Return error text to the model so it can handle it or report it
            return { error: result.error };
          }
          return result.data;
        }
      } as any);
    }

    return sdkTools;
  }
}
export const registry = ToolRegistry.getInstance();
