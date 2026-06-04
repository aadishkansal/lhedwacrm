// src/modules/agents/tools/types.ts

import { z } from 'zod';

export interface ToolContext {
  organizationId: string;
  userId?: string;          // optional user executing this
  userRole?: string;        // e.g. 'admin', 'agent', 'bot'
  userPermissions?: string[]; // scopes / roles the user has
  executionId?: string;     // parent execution ID in agent_executions table
  sessionId?: string;       // optional conversation / chat session ID
}

export interface AgentTool<I = any, O = any> {
  name: string;
  description: string;
  schema: z.ZodSchema<I>;   // Zod schema for input validation
  permissions: string[];    // required permissions, e.g., ['read:customer', 'write:ticket']
  handler: (input: I, context: ToolContext) => Promise<O>;
  
  // Optional retry configuration for this tool
  retryConfig?: {
    maxAttempts?: number;
    initialDelayMs?: number;
    backoffFactor?: number;
  };
}

export interface ToolExecutionResult<O = any> {
  success: boolean;
  data?: O;
  error?: string;
  durationMs: number;
  attempts: number;
}
