// src/modules/agents/services/model-registry.ts

export interface ModelMetadata {
  id: string; // Model identifier, e.g., 'gpt-4o-mini'
  provider: 'openai' | 'gemini' | 'google' | string;
  displayName: string;
  inputTokenCostPerMillion: number; // in USD
  outputTokenCostPerMillion: number; // in USD
  maxTokens: number;
}

export class ModelRegistry {
  private static models: Map<string, ModelMetadata> = new Map([
    [
      'gpt-4o-mini',
      {
        id: 'gpt-4o-mini',
        provider: 'openai',
        displayName: 'GPT-4o Mini',
        inputTokenCostPerMillion: 0.150, // $0.15 per million input tokens
        outputTokenCostPerMillion: 0.600, // $0.60 per million output tokens
        maxTokens: 128000,
      }
    ],
    [
      'gpt-4',
      {
        id: 'gpt-4',
        provider: 'openai',
        displayName: 'GPT-4',
        inputTokenCostPerMillion: 30.00, // $30 per million input tokens
        outputTokenCostPerMillion: 60.00, // $60 per million output tokens
        maxTokens: 8192,
      }
    ],
    [
      'gpt-4.1',
      {
        id: 'gpt-4', // Maps to standard gpt-4 in API calls
        provider: 'openai',
        displayName: 'GPT-4.1',
        inputTokenCostPerMillion: 30.00,
        outputTokenCostPerMillion: 60.00,
        maxTokens: 8192,
      }
    ],
    [
      'gemini-2.5-flash',
      {
        id: 'gemini-2.5-flash',
        provider: 'google',
        displayName: 'Gemini 2.5 Flash',
        inputTokenCostPerMillion: 0.075,
        outputTokenCostPerMillion: 0.300,
        maxTokens: 1048576,
      }
    ]
  ]);

  static getModel(id: string): ModelMetadata {
    const model = this.models.get(id);
    if (!model) {
      throw new Error(`Model ${id} not found in registry`);
    }
    return model;
  }

  static register(model: ModelMetadata): void {
    this.models.set(model.id, model);
  }

  static listModels(): ModelMetadata[] {
    return Array.from(this.models.values());
  }
}
