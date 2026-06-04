import { generateText } from "ai";
import { google } from "@ai-sdk/google";

export async function triageIncomingMessage(message: string) {
  const { text } = await generateText({
    model: google("gemini-2.5-flash"),
    system: "You are an AI routing agent for a Solar EPC company. Classify the user message as either 'SALES_LEAD', 'SUPPORT_TICKET', or 'OTHER'. Reply with ONLY the classification string.",
    prompt: message,
  });

  return text.trim();
}
