// src/modules/agents/services/agent-manager.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { agentLoader } from './agent-loader';

export interface CreateAgentParams {
  name: string;
  description?: string;
  role: 'supervisor' | 'sales' | 'support' | 'installation' | 'finance';
  systemPrompt: string;
  allowedTools?: string[];
  model?: string;
  temperature?: number;
  kbAccess?: boolean;
  status?: 'active' | 'inactive';
}

export interface UpdateAgentParams {
  name?: string;
  description?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  model?: string;
  temperature?: number;
  kbAccess?: boolean;
  status?: 'active' | 'inactive';
  userId?: string; // Track who made the prompt change
}

export class AgentManager {
  /**
   * Create a new agent configuration and logs version 1.
   */
  async createAgent(organizationId: string, params: CreateAgentParams, userId?: string) {
    const db = supabaseAdmin();

    const { data: agent, error } = await db
      .from('agent_configs')
      .insert({
        organization_id: organizationId,
        name: params.name,
        description: params.description || null,
        role: params.role,
        system_prompt: params.systemPrompt,
        allowed_tools: params.allowedTools || [],
        model: params.model || 'gemini-2.5-flash',
        temperature: params.temperature ?? 0.3,
        kb_access: params.kbAccess ?? false,
        status: params.status || 'active',
        current_version: 1,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create agent: ${error.message}`);
    }

    // Log prompt version 1
    const { error: vError } = await db.from('agent_prompt_versions').insert({
      organization_id: organizationId,
      agent_id: agent.id,
      system_prompt: params.systemPrompt,
      version: 1,
      created_by: userId || null,
    });

    if (vError) {
      throw new Error(`Failed to log prompt version 1: ${vError.message}`);
    }

    agentLoader.clearCache();
    return agent;
  }

  /**
   * Update agent configuration. Increments version if system prompt changes.
   */
  async updateAgent(agentId: string, organizationId: string, params: UpdateAgentParams) {
    const db = supabaseAdmin();

    // 1. Get current active config
    const { data: current, error: fetchError } = await db
      .from('agent_configs')
      .select('*')
      .eq('id', agentId)
      .eq('organization_id', organizationId)
      .single();

    if (fetchError || !current) {
      throw new Error(`Agent not found: ${fetchError?.message || 'Invalid ID'}`);
    }

    const updates: Record<string, any> = {};
    if (params.name !== undefined) updates.name = params.name;
    if (params.description !== undefined) updates.description = params.description;
    if (params.systemPrompt !== undefined) updates.system_prompt = params.systemPrompt;
    if (params.allowedTools !== undefined) updates.allowed_tools = params.allowedTools;
    if (params.model !== undefined) updates.model = params.model;
    if (params.temperature !== undefined) updates.temperature = params.temperature;
    if (params.kbAccess !== undefined) updates.kb_access = params.kbAccess;
    if (params.status !== undefined) updates.status = params.status;

    const isPromptChanged = params.systemPrompt !== undefined && params.systemPrompt !== current.system_prompt;
    let nextVersion = current.current_version;

    if (isPromptChanged) {
      nextVersion = current.current_version + 1;
      updates.current_version = nextVersion;
    }

    // 2. Perform DB update
    const { data: updated, error: updateError } = await db
      .from('agent_configs')
      .update(updates)
      .eq('id', agentId)
      .eq('organization_id', organizationId)
      .select('*')
      .single();

    if (updateError) {
      throw new Error(`Failed to update agent: ${updateError.message}`);
    }

    // 3. Log new prompt version if changed
    if (isPromptChanged && params.systemPrompt) {
      const { error: vError } = await db.from('agent_prompt_versions').insert({
        organization_id: organizationId,
        agent_id: agentId,
        system_prompt: params.systemPrompt,
        version: nextVersion,
        created_by: params.userId || null,
      });

      if (vError) {
        throw new Error(`Failed to log prompt version ${nextVersion}: ${vError.message}`);
      }
    }

    agentLoader.clearCache();
    return updated;
  }

  /**
   * Rollback agent system prompt to a specific version number.
   */
  async rollbackPrompt(agentId: string, organizationId: string, versionNumber: number, userId?: string) {
    const db = supabaseAdmin();

    // 1. Find historical version
    const { data: historical, error: vError } = await db
      .from('agent_prompt_versions')
      .select('*')
      .eq('agent_id', agentId)
      .eq('version', versionNumber)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (vError || !historical) {
      throw new Error(`Prompt version ${versionNumber} not found: ${vError?.message || 'Invalid version'}`);
    }

    // 2. Update active prompt (this increments active version count to keep version history strictly sequential)
    const { data: current } = await db
      .from('agent_configs')
      .select('current_version')
      .eq('id', agentId)
      .single();

    const nextVersion = (current?.current_version || 1) + 1;

    const { data: updated, error: updateError } = await db
      .from('agent_configs')
      .update({
        system_prompt: historical.system_prompt,
        current_version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agentId)
      .eq('organization_id', organizationId)
      .select('*')
      .single();

    if (updateError) {
      throw new Error(`Failed to rollback agent config: ${updateError.message}`);
    }

    // 3. Log rollback as a new version entry
    const { error: rollVError } = await db.from('agent_prompt_versions').insert({
      organization_id: organizationId,
      agent_id: agentId,
      system_prompt: historical.system_prompt,
      version: nextVersion,
      created_by: userId || null,
    });

    if (rollVError) {
      throw new Error(`Failed to log rollback version ${nextVersion}: ${rollVError.message}`);
    }

    agentLoader.clearCache();
    return updated;
  }

  /**
   * Get all version entries for an agent.
   */
  async getVersions(agentId: string, organizationId: string) {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('agent_prompt_versions')
      .select('*')
      .eq('agent_id', agentId)
      .eq('organization_id', organizationId)
      .order('version', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch prompt versions: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Delete an agent configuration and all its prompt versions.
   */
  async deleteAgent(agentId: string, organizationId: string): Promise<void> {
    const db = supabaseAdmin();
    const { error } = await db
      .from('agent_configs')
      .delete()
      .eq('id', agentId)
      .eq('organization_id', organizationId);

    if (error) {
      throw new Error(`Failed to delete agent config: ${error.message}`);
    }

    agentLoader.clearCache();
  }
}

export const agentManager = new AgentManager();
