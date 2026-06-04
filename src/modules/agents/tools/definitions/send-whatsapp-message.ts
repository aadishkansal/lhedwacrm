// src/modules/agents/tools/definitions/send-whatsapp-message.ts

import { z } from 'zod';
import { AgentTool } from '../types';
import { engineSendText } from '../../../workflows/services/meta-send';

const inputSchema = z.object({
  contactId: z.string().uuid({ message: 'A valid contactId UUID is required' }),
  conversationId: z.string().uuid({ message: 'A valid conversationId UUID is required' }),
  text: z.string().min(1, { message: 'Message text cannot be empty' }),
});

export const sendWhatsAppMessageTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'SendWhatsAppMessage',
  description: 'Sends a direct text message to the customer via the WhatsApp Business API.',
  schema: inputSchema,
  permissions: ['write:message'],
  handler: async (input, context) => {
    const userId = context.userId;

    if (!userId) {
      throw new Error('No user ID found in context to send message from.');
    }

    const result = await engineSendText({
      userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      text: input.text,
    });

    return { success: true, messageId: (result as any)?.message_id || 'sent' };
  },
};
