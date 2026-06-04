// src/modules/agents/types.ts

export type ModelRole = 'triage' | 'chat' | 'extraction' | 'embedding';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIRequest {
  systemPrompt?: string;
  messages: AIMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface AIResponse {
  text: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  modelUsed: string;
  provider: string;
  promptCost?: number;
  completionCost?: number;
  totalCost?: number;
}

export interface AIProvider {
  id: string;
  generate(request: AIRequest): Promise<AIResponse>;
  generateStream(request: AIRequest): Promise<ReadableStream<any>>;
}

export interface AgentExecutionLog {
  organizationId: string;
  sessionId: string;
  agentName: string;
  status: 'completed' | 'failed';
  usage: TokenUsage;
  durationMs: number;
  errorMessage?: string;
  toolCalls?: Array<{
    name: string;
    durationMs: number;
    arguments: any;
    result: any;
  }>;
}
