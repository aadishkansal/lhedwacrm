import { serve } from "inngest/next";
import { inngest } from "../../../core/inngest/client";

// Export the Inngest handler for Vercel / Next.js
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // Register background functions here later
  ],
});
