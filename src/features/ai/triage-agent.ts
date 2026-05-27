import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function triageIncomingMessage(message: string) {
  const { text } = await generateText({
    model: openai("gpt-4o"),
    system: "You are an AI routing agent for a Solar EPC company. Classify the user message as either 'SALES_LEAD', 'SUPPORT_TICKET', or 'OTHER'. Reply with ONLY the classification string.",
    prompt: message,
  });

  return text.trim();
}
