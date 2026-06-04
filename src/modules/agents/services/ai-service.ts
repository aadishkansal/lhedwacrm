// src/modules/agents/services/ai-service.ts

import { generateText, streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { ModelRegistry } from './model-registry';
import { UsageTracker } from './usage-tracker';
import { checkRateLimit } from '../../../lib/rate-limit';
import { AIResponse } from '../types';

export interface GenerateOptions {
  modelId: string;
  systemPrompt?: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  organizationId: string;
  sessionId: string;
  agentName: string;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, any>;
  }>;
  retries?: number;
}

const FALLBACK_MAP: Record<string, string> = {
  'gpt-4': 'gpt-4o-mini',
  'gpt-4.1': 'gpt-4o-mini',
  'gpt-4o-mini': 'gemini-2.5-flash',
  'gemini-2.5-flash': 'gpt-4o-mini',
};

export class AIService {
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
    initialDelay = 500
  ): Promise<T> {
    let attempt = 0;
    while (attempt < retries) {
      try {
        return await fn();
      } catch (err: any) {
        attempt++;
        if (attempt >= retries) throw err;
        const delay = Math.pow(2, attempt) * initialDelay;
        console.warn(`AI execution attempt ${attempt} failed. Retrying in ${delay}ms. Error: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('Retries exhausted');
  }

  async generate(options: GenerateOptions): Promise<AIResponse> {
    const startTime = Date.now();
    let currentModelId = options.modelId;
    let attemptCount = 0;
    let lastError: any = null;

    while (attemptCount < 2) {
      try {
        const metadata = ModelRegistry.getModel(currentModelId);
        const actualModelName = metadata.id;

        // 1. Rate limiting check (60 calls per min per organization + model)
        const rateLimitKey = `ai:${options.organizationId}:${actualModelName}`;
        const rateLimitResult = checkRateLimit(rateLimitKey, { limit: 60, windowMs: 60000 });
        if (!rateLimitResult.success) {
          throw new Error(`Rate limit exceeded for model ${actualModelName}`);
        }

        // 2. Resolve provider model
        let providerModel;
        if (metadata.provider === 'openai') {
          providerModel = openai(actualModelName);
        } else if (metadata.provider === 'google' || metadata.provider === 'gemini') {
          providerModel = google(actualModelName);
        } else {
          throw new Error(`Unsupported provider: ${metadata.provider}`);
        }

        // 3. Call LLM with retry handling
        const response = await this.executeWithRetry(async () => {
          return await generateText({
            model: providerModel,
            system: options.systemPrompt,
            messages: options.messages as any,
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens,
          });
        }, options.retries ?? 3);

        const durationMs = Date.now() - startTime;
        const promptTokens = response.usage?.inputTokens ?? 0;
        const completionTokens = response.usage?.outputTokens ?? 0;

        // 4. Track Usage and Costs
        await UsageTracker.logUsage({
          organizationId: options.organizationId,
          sessionId: options.sessionId,
          agentName: options.agentName,
          modelId: currentModelId,
          promptTokens,
          completionTokens,
          durationMs,
          status: 'completed',
          toolCalls: response.toolCalls?.map(tc => ({
            name: tc.toolName,
            arguments: tc.input || {},
            result: null,
            durationMs: 0
          }))
        });

        const { promptCost, completionCost, totalCost } = UsageTracker.calculateCost(
          currentModelId,
          promptTokens,
          completionTokens
        );

        return {
          text: response.text,
          toolCalls: response.toolCalls?.map(tc => ({
            id: tc.toolCallId,
            name: tc.toolName,
            arguments: (tc.input as Record<string, any>) || {},
          })),
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          },
          modelUsed: actualModelName,
          provider: metadata.provider,
          promptCost,
          completionCost,
          totalCost
        };

      } catch (err: any) {
        lastError = err;
        console.warn(`Execution failed for model ${currentModelId}: ${err.message}`);

        // Try fallback
        const fallback = FALLBACK_MAP[currentModelId];
        if (fallback && attemptCount === 0) {
          console.warn(`Falling back from ${currentModelId} to ${fallback}`);
          currentModelId = fallback;
          attemptCount++;
        } else {
          break;
        }
      }
    }

    // If both primary and fallback fail, log failure
    const durationMs = Date.now() - startTime;
    await UsageTracker.logUsage({
      organizationId: options.organizationId,
      sessionId: options.sessionId,
      agentName: options.agentName,
      modelId: options.modelId,
      promptTokens: 0,
      completionTokens: 0,
      durationMs,
      status: 'failed',
      errorMessage: lastError?.message || 'Execution failed'
    });

    throw new Error(`AI generation failed: ${lastError?.message || 'Unknown error'}`);
  }

  async generateStream(options: GenerateOptions): Promise<ReadableStream<any>> {
    const startTime = Date.now();
    let currentModelId = options.modelId;
    let attemptCount = 0;
    let lastError: any = null;

    while (attemptCount < 2) {
      try {
        const metadata = ModelRegistry.getModel(currentModelId);
        const actualModelName = metadata.id;

        // Rate limit check
        const rateLimitKey = `ai:${options.organizationId}:${actualModelName}`;
        const rateLimitResult = checkRateLimit(rateLimitKey, { limit: 60, windowMs: 60000 });
        if (!rateLimitResult.success) {
          throw new Error(`Rate limit exceeded for model ${actualModelName}`);
        }

        let providerModel;
        if (metadata.provider === 'openai') {
          providerModel = openai(actualModelName);
        } else if (metadata.provider === 'google' || metadata.provider === 'gemini') {
          providerModel = google(actualModelName);
        } else {
          throw new Error(`Unsupported provider: ${metadata.provider}`);
        }

        const { textStream } = await streamText({
          model: providerModel,
          system: options.systemPrompt,
          messages: options.messages as any,
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
          onFinish: async (event) => {
            const durationMs = Date.now() - startTime;
            const promptTokens = event.usage?.inputTokens ?? 0;
            const completionTokens = event.usage?.outputTokens ?? 0;

            await UsageTracker.logUsage({
              organizationId: options.organizationId,
              sessionId: options.sessionId,
              agentName: options.agentName,
              modelId: currentModelId,
              promptTokens,
              completionTokens,
              durationMs,
              status: 'completed',
              toolCalls: event.toolCalls?.map(tc => ({
                name: tc.toolName,
                arguments: (tc as any).args || {},
                result: null,
                durationMs: 0
              }))
            });
          }
        });

        return textStream as any;

      } catch (err: any) {
        lastError = err;
        console.warn(`Streaming failed for model ${currentModelId}: ${err.message}`);

        const fallback = FALLBACK_MAP[currentModelId];
        if (fallback && attemptCount === 0) {
          console.warn(`Streaming falling back from ${currentModelId} to ${fallback}`);
          currentModelId = fallback;
          attemptCount++;
        } else {
          break;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    await UsageTracker.logUsage({
      organizationId: options.organizationId,
      sessionId: options.sessionId,
      agentName: options.agentName,
      modelId: options.modelId,
      promptTokens: 0,
      completionTokens: 0,
      durationMs,
      status: 'failed',
      errorMessage: lastError?.message || 'Streaming failed'
    });

    throw new Error(`AI streaming failed: ${lastError?.message || 'Unknown error'}`);
  }
}
