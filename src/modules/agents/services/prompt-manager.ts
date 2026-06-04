// src/modules/agents/services/prompt-manager.ts

export interface PromptTemplate {
  id: string;
  template: string;
  requiredVariables: string[];
}

export class PromptManager {
  private templates: Map<string, PromptTemplate> = new Map();

  constructor() {
    // Register some default CRM prompt templates
    this.register({
      id: 'triage',
      template: 'You are an AI routing agent for a Solar EPC company. Classify the user message as either \'SALES_LEAD\', \'SUPPORT_TICKET\', or \'OTHER\'. Reply with ONLY the classification string.\nMessage: {{message}}',
      requiredVariables: ['message']
    });

    this.register({
      id: 'support_assistant',
      template: 'You are an AI support assistant for our Solar company. Use the following context to answer customer support questions:\nContext:\n{{context}}\n\nCustomer Message: {{message}}',
      requiredVariables: ['context', 'message']
    });

    this.register({
      id: 'quotation_explainer',
      template: 'Explain the details of this Solar quotation. Highlight system size, total price, and expected savings:\nQuotation Details:\n{{quoteDetails}}',
      requiredVariables: ['quoteDetails']
    });
  }

  register(template: PromptTemplate): void {
    this.templates.set(template.id, template);
  }

  render(id: string, variables: Record<string, string>): string {
    const t = this.templates.get(id);
    if (!t) throw new Error(`Prompt template ${id} not found`);
    let rendered = t.template;
    for (const v of t.requiredVariables) {
      if (!(v in variables)) {
        throw new Error(`Missing required variable "${v}" for template "${id}"`);
      }
      rendered = rendered.replace(new RegExp(`{{${v}}}`, 'g'), variables[v]);
    }
    return rendered;
  }
}
