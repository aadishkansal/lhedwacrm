// src/modules/agents/services/orchestrator.ts

import { ModelRole, AIRequest, AIResponse } from '../types';
import { AIService } from './ai-service';

export class AIOrchestrator {
  private aiService = new AIService();
  private roleModelMap: Record<ModelRole, string> = {
    triage: 'gemini-2.5-flash',
    chat: 'gemini-2.5-flash',
    extraction: 'gemini-2.5-flash',
    embedding: 'gemini-2.5-flash'
  };

  registerProvider(provider: any): void {
    // Deprecated: Registry is now centralized via ModelRegistry.
    // Kept for backward compatibility.
  }

  async execute(params: {
    role: ModelRole;
    request: AIRequest;
    organizationId: string;
    sessionId: string;
    agentName: string;
    retries?: number;
  }): Promise<AIResponse> {
    const modelId = this.roleModelMap[params.role] || 'gemini-2.5-flash';
    return await this.aiService.generate({
      modelId,
      systemPrompt: params.request.systemPrompt,
      messages: params.request.messages,
      temperature: params.request.temperature,
      maxTokens: params.request.maxTokens,
      organizationId: params.organizationId,
      sessionId: params.sessionId,
      agentName: params.agentName,
      retries: params.retries
    });
  }
}
