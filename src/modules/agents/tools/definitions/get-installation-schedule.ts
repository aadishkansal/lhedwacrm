// src/modules/agents/tools/definitions/get-installation-schedule.ts

import { z } from 'zod';
import { AgentTool } from '../types';
import { salesPortalConnector } from '../../../crm/services/sales-portal-connector';

const inputSchema = z.object({
  projectId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
}).refine(data => data.projectId || data.contactId, {
  message: "Either projectId or contactId must be provided",
});

export const getInstallationScheduleTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'GetInstallationSchedule',
  description: 'Retrieves the physical installation slot details, scheduled date, installer name, status, and net metering status by projectId or contactId.',
  schema: inputSchema,
  permissions: ['read:project'],
  handler: async (input, context) => {
    let installations: any[] = [];

    if (input.projectId) {
      installations = await salesPortalConnector.getInstallationsByProject(input.projectId);
    } else if (input.contactId) {
      const projects = await salesPortalConnector.getProjectProgressByContact(input.contactId);
      if (projects && projects.length > 0) {
        const promises = projects.map(p => salesPortalConnector.getInstallationsByProject(p.id));
        const results = await Promise.all(promises);
        installations = results.flat();
      }
    }

    return {
      installations,
      netMetering: installations.map(i => ({
        project_id: i.projectId,
        status: i.netMeteringStatus,
      })),
      updates: installations.map(i => ({
        project_id: i.projectId,
        status: i.status,
        scheduled_at: i.scheduledAt,
        installer_name: i.installerName,
      })),
    };
  },
};
