import { serve } from "inngest/next";
import { inngest } from "../../../core/inngest/client";
import { executeWorkflowInstance } from "../../../modules/workflows/services/inngest-engine";
import { dailyLeadReEvaluation } from "../../../modules/sales/services/sales-lead-cron";

// Export the Inngest handler for Vercel / Next.js
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    executeWorkflowInstance,
    dailyLeadReEvaluation,
  ],
});
