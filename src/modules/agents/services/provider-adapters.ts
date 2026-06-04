// src/modules/agents/services/provider-adapters.ts

import { generateText, streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { AIProvider, AIRequest, AIResponse } from '../types';

export class OpenAIAdapter implements AIProvider {
  id = 'openai';
  private modelName: string;

  constructor(modelName = 'gpt-4o') {
    this.modelName = modelName;
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const { text, usage, toolCalls } = await generateText({
      model: openai(this.modelName),
      system: request.systemPrompt,
      messages: request.messages,
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
    });

    return {
      text,
      toolCalls: toolCalls?.map(tc => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: (tc.input as Record<string, any>) || {},
      })),
      usage: {
        promptTokens: usage?.inputTokens ?? 0,
        completionTokens: usage?.outputTokens ?? 0,
        totalTokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
      },
      modelUsed: this.modelName,
      provider: 'openai',
    };
  }

  async generateStream(request: AIRequest): Promise<ReadableStream<any>> {
    const { textStream } = await streamText({
      model: openai(this.modelName),
      system: request.systemPrompt,
      messages: request.messages,
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
    });
    // Convert the AsyncIterable textStream into a standard ReadableStream if needed,
    // or just return the textStream which behaves like an AsyncIterable in Next.js.
    return textStream as any;
  }
}

export class GeminiAdapter implements AIProvider {
  id = 'gemini';
  private modelName: string;

  constructor(modelName = 'gemini-2.5-flash') {
    this.modelName = modelName;
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const { text, usage, toolCalls } = await generateText({
      model: google(this.modelName),
      system: request.systemPrompt,
      messages: request.messages,
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
    });

    return {
      text,
      toolCalls: toolCalls?.map(tc => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: (tc.input as Record<string, any>) || {},
      })),
      usage: {
        promptTokens: usage?.inputTokens ?? 0,
        completionTokens: usage?.outputTokens ?? 0,
        totalTokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
      },
      modelUsed: this.modelName,
      provider: 'gemini',
    };
  }

  async generateStream(request: AIRequest): Promise<ReadableStream<any>> {
    const { textStream } = await streamText({
      model: google(this.modelName),
      system: request.systemPrompt,
      messages: request.messages,
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
    });
    return textStream as any;
  }
}
