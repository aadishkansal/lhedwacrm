// src/modules/agents/services/department-agents.ts

import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { registry } from '../tools/index';
import { ToolContext } from '../tools/types';
import { CustomerContext } from '../../crm/services/customer-context-service';
import { agentLoader } from './agent-loader';
import { PromptBuilder } from './prompt-builder';

export interface DepartmentAgentParams {
  contactId: string;
  organizationId: string;
  conversationId: string;
  userId: string;
  messageText: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  customerContext: CustomerContext;
}

// ============================================================
// Sales Department Agent
// ============================================================
export async function runSalesAgent(params: DepartmentAgentParams): Promise<string> {
  const config = await agentLoader.loadAgent(params.organizationId, 'sales');

  const toolContext: ToolContext = {
    organizationId: params.organizationId,
    userId: params.userId,
    userRole: 'bot',
    sessionId: params.conversationId,
  };

  const salesTools = registry.toSDKTools(toolContext, config.allowedTools);

  const systemPrompt = PromptBuilder.buildPrompt(config.systemPrompt, {
    customerContext: params.customerContext,
    messageText: params.messageText,
  });

  const { text } = await generateText({
    model: google(config.model),
    system: systemPrompt,
    messages: [
      ...params.history,
      { role: 'user', content: params.messageText }
    ] as any,
    tools: salesTools,
    maxSteps: 5,
    temperature: config.temperature,
  } as any);

  return text;
}

// ============================================================
// Support Department Agent
// ============================================================
export async function runSupportAgent(params: DepartmentAgentParams): Promise<string> {
  const config = await agentLoader.loadAgent(params.organizationId, 'support');

  const toolContext: ToolContext = {
    organizationId: params.organizationId,
    userId: params.userId,
    userRole: 'bot',
    sessionId: params.conversationId,
  };

  const supportTools = registry.toSDKTools(toolContext, config.allowedTools);

  const systemPrompt = PromptBuilder.buildPrompt(config.systemPrompt, {
    customerContext: params.customerContext,
    messageText: params.messageText,
  });

  const { text } = await generateText({
    model: google(config.model),
    system: systemPrompt,
    messages: [
      ...params.history,
      { role: 'user', content: params.messageText }
    ] as any,
    tools: supportTools,
    maxSteps: 5,
    temperature: config.temperature,
  } as any);

  return text;
}

// ============================================================
// Installation Department Agent
// ============================================================
export async function runInstallationAgent(params: DepartmentAgentParams): Promise<string> {
  const config = await agentLoader.loadAgent(params.organizationId, 'installation');

  const toolContext: ToolContext = {
    organizationId: params.organizationId,
    userId: params.userId,
    userRole: 'bot',
    sessionId: params.conversationId,
  };

  const installationTools = registry.toSDKTools(toolContext, config.allowedTools);

  const systemPrompt = PromptBuilder.buildPrompt(config.systemPrompt, {
    customerContext: params.customerContext,
    messageText: params.messageText,
  });

  const { text } = await generateText({
    model: google(config.model),
    system: systemPrompt,
    messages: [
      ...params.history,
      { role: 'user', content: params.messageText }
    ] as any,
    tools: installationTools,
    maxSteps: 5,
    temperature: config.temperature,
  } as any);

  return text;
}

// ============================================================
// Finance Department Agent
// ============================================================
export async function runFinanceAgent(params: DepartmentAgentParams): Promise<string> {
  const config = await agentLoader.loadAgent(params.organizationId, 'finance');

  const toolContext: ToolContext = {
    organizationId: params.organizationId,
    userId: params.userId,
    userRole: 'bot',
    sessionId: params.conversationId,
  };

  const financeTools = registry.toSDKTools(toolContext, config.allowedTools);

  const systemPrompt = PromptBuilder.buildPrompt(config.systemPrompt, {
    customerContext: params.customerContext,
    messageText: params.messageText,
  });

  const { text } = await generateText({
    model: google(config.model),
    system: systemPrompt,
    messages: [
      ...params.history,
      { role: 'user', content: params.messageText }
    ] as any,
    tools: financeTools,
    maxSteps: 5,
    temperature: config.temperature,
  } as any);

  return text;
}
