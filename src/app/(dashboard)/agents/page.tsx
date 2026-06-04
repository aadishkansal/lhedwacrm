'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Bot,
  Sliders,
  History,
  Play,
  Check,
  Loader2,
  AlertCircle,
  Trash2,
  HelpCircle,
  CheckCircle2,
  XCircle,
  FileText,
  RotateCcw,
  Sparkles,
  ChevronRight,
  Terminal,
  ArrowLeft,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Agent {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  role: 'supervisor' | 'sales' | 'support' | 'installation' | 'finance';
  system_prompt: string;
  allowed_tools: string[];
  model: string;
  temperature: number;
  kb_access: boolean;
  status: 'active' | 'inactive';
  current_version: number;
  created_at: string;
  updated_at: string;
}

interface ToolInfo {
  name: string;
  description: string;
}

interface PromptVersion {
  id: string;
  version: number;
  system_prompt: string;
  created_by: string | null;
  created_at: string;
}

interface TestResult {
  text: string;
  toolCalls: Array<{
    name: string;
    args: Record<string, any>;
  }>;
  interpolatedPrompt: string;
  contextUsed: {
    customerName: string;
    customerPhone: string;
  };
}

const MODELS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Google)' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini (OpenAI)' },
  { value: 'gpt-4', label: 'GPT-4 (OpenAI)' },
];

const TEMPLATE_VARIABLES = [
  { tag: '{{customer_name}}', desc: 'Full name of the contact' },
  { tag: '{{customer_phone}}', desc: 'WhatsApp phone number' },
  { tag: '{{project_status}}', desc: 'Solar EPC project status' },
  { tag: '{{project_id}}', desc: 'Solar project identifier' },
  { tag: '{{lead_status}}', desc: 'Lead status stage' },
  { tag: '{{lead_budget}}', desc: 'Lead customer budget info' },
  { tag: '{{lead_requirements}}', desc: 'Custom solar panel requirements' },
  { tag: '{{conversion_status}}', desc: 'Converted vs Not Converted status' },
  { tag: '{{proposal_size}}', desc: 'Solar panel sizing in kW' },
  { tag: '{{proposal_amount}}', desc: 'Total quotation value' },
  { tag: '{{proposal_status}}', desc: 'Status of the solar quote' },
  { tag: '{{installation_date}}', desc: 'Scheduled date of site visit/install' },
  { tag: '{{pending_invoices_count}}', desc: 'Number of pending invoices' },
  { tag: '{{message_text}}', desc: 'Incoming message trigger content' },
];

// Placeholder values used for client-side Prompt Preview (template variable demonstration only)
const MOCK_CONTEXT = {
  customer_name: 'Sample Customer',
  customer_phone: '+910000000000',
  project_status: 'design_approved',
  project_id: 'project-demo',
  lead_status: 'nurturing',
  lead_budget: '₹15,00,000',
  lead_requirements: '5kW Rooftop Solar Installation',
  conversion_status: 'Not Converted',
  proposal_size: '5kW',
  proposal_amount: '₹4,50,000',
  proposal_status: 'proposal_sent',
  installation_slot_id: 'slot-demo',
  installation_date: new Date(Date.now() + 86400000 * 14).toISOString(),
  pending_invoices_count: 0,
  message_text: 'What solar components are covered under my quote?',
};

export default function AgentManagerPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [activePane, setActivePane] = useState<'list' | 'workbench'>('list');
  const workbenchRef = useRef<HTMLDivElement>(null);
  
  // Selected Agent details tabs tabs
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  // Edit State Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.3);
  const [kbAccess, setKbAccess] = useState(false);
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('');
  
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);

  // Rollback state dialog
  const [rollingVersion, setRollingVersion] = useState<PromptVersion | null>(null);
  const [isRolling, setIsRolling] = useState(false);

  // Preview Prompt state dialog
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Test prompt states
  const [testMessage, setTestMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Reset / Delete agent dialog states
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // 1. Fetch agents & tools inventory
  const fetchAgentsAndTools = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError(null);
    try {
      const [agentsRes, toolsRes] = await Promise.all([
        fetch('/api/agents'),
        fetch('/api/agents/tools'),
      ]);

      if (!agentsRes.ok) throw new Error('Failed to load agent configurations');
      if (!toolsRes.ok) throw new Error('Failed to load tools registry');

      const agentsData = await agentsRes.json();
      const toolsData = await toolsRes.json();

      setAgents(agentsData.agents || []);
      setTools(toolsData.tools || []);

      // Autoselect first agent or keep current selection updated
      if (agentsData.agents && agentsData.agents.length > 0) {
        const currentSel = selectedAgent
          ? agentsData.agents.find((a: Agent) => a.id === selectedAgent.id) || agentsData.agents[0]
          : agentsData.agents[0];
        
        setSelectedAgent(currentSel);
        initFormValues(currentSel);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  }, [selectedAgent]);

  // Load version history for selected agent
  const fetchVersionHistory = useCallback(async (agentId: string) => {
    setLoadingVersions(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/versions`);
      if (!res.ok) throw new Error('Failed to load versions');
      const data = await res.json();
      setVersions(data.versions || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingVersions(false);
    }
  }, []);

  useEffect(() => {
    fetchAgentsAndTools();
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      fetchVersionHistory(selectedAgent.id);
      setTestResult(null);
      setTestError(null);
    }
  }, [selectedAgent?.id, fetchVersionHistory]);

  const initFormValues = (agent: Agent) => {
    setName(agent.name);
    setDescription(agent.description || '');
    setModel(agent.model);
    setTemperature(Number(agent.temperature));
    setKbAccess(agent.kb_access);
    setStatus(agent.status);
    setAllowedTools(agent.allowed_tools || []);
    setSystemPrompt(agent.system_prompt);
  };

  // Toggle tool binding
  const handleToolToggle = (toolName: string) => {
    setAllowedTools((prev) =>
      prev.includes(toolName)
        ? prev.filter((t) => t !== toolName)
        : [...prev, toolName]
    );
  };

  // Save Configurations (Metadata/Parameters/Tools)
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent) return;
    setSavingConfig(true);

    try {
      const res = await fetch(`/api/agents/${selectedAgent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          model,
          temperature,
          kbAccess,
          status,
          allowedTools,
        }),
      });

      if (!res.ok) throw new Error('Failed to update configuration');
      const data = await res.json();
      
      // Update local lists
      setAgents((prev) => prev.map((a) => (a.id === data.agent.id ? data.agent : a)));
      setSelectedAgent(data.agent);
      alert('Configuration updated successfully!');
    } catch (err: any) {
      alert(err.message || 'Error updating configuration.');
    } finally {
      setSavingConfig(false);
    }
  };

  // Save System Prompt (triggers version increment)
  const handleSavePrompt = async () => {
    if (!selectedAgent) return;
    setSavingPrompt(true);

    try {
      const res = await fetch(`/api/agents/${selectedAgent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: systemPrompt.trim(),
        }),
      });

      if (!res.ok) throw new Error('Failed to update system prompt');
      const data = await res.json();

      setAgents((prev) => prev.map((a) => (a.id === data.agent.id ? data.agent : a)));
      setSelectedAgent(data.agent);
      fetchVersionHistory(data.agent.id);
      alert('System prompt updated! Version incremented.');
    } catch (err: any) {
      alert(err.message || 'Error updating system prompt.');
    } finally {
      setSavingPrompt(false);
    }
  };

  // Rollback System Prompt
  const handleRollbackConfirm = async () => {
    if (!selectedAgent || !rollingVersion) return;
    setIsRolling(true);

    try {
      const res = await fetch(`/api/agents/${selectedAgent.id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: rollingVersion.version }),
      });

      if (!res.ok) throw new Error('Rollback failed');
      const data = await res.json();

      // Reset prompt field and reload list
      setSystemPrompt(data.agent.system_prompt);
      setAgents((prev) => prev.map((a) => (a.id === data.agent.id ? data.agent : a)));
      setSelectedAgent(data.agent);
      fetchVersionHistory(data.agent.id);
      setRollingVersion(null);
      alert(`Prompt successfully rolled back to Version ${rollingVersion.version}.`);
    } catch (err: any) {
      alert(err.message || 'Rollback failed.');
    } finally {
      setIsRolling(false);
    }
  };

  // Reset / Delete agent config (triggers default templating on re-fetch)
  const handleDeleteConfirm = async () => {
    if (!deletingAgent) return;
    setIsDeleting(true);

    try {
      const res = await fetch(`/api/agents/${deletingAgent.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete agent configuration');

      setDeletingAgent(null);
      await fetchAgentsAndTools();
      alert('Agent configuration reset. Seeded back to default templates.');
    } catch (err: any) {
      alert(err.message || 'Error deleting configuration');
    } finally {
      setIsDeleting(false);
    }
  };

  // Execute Prompt Test Sandbox
  const handleRunTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent || !testMessage.trim()) return;

    setTesting(true);
    setTestError(null);
    setTestResult(null);

    try {
      const res = await fetch(`/api/agents/${selectedAgent.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: testMessage.trim(),
          systemPrompt, // Test unsaved prompt modifications
          model,
          temperature,
          allowedTools,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Test sandbox execution failed');
      }

      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestError(err.message || 'An error occurred during sandbox execution.');
    } finally {
      setTesting(false);
    }
  };

  // Client side prompt preview compiler
  const interpolatedPreviewPrompt = useMemo(() => {
    let result = systemPrompt;
    for (const [key, val] of Object.entries(MOCK_CONTEXT)) {
      const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
      result = result.replace(placeholder, String(val));
    }
    return result;
  }, [systemPrompt]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading && agents.length === 0) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-slate-400">Loading Agent Console configurations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Agent Manager
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Configure system prompts, customize tool permissions, roll back historical prompts, and test generations.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Side: Agents List */}
        <div className={`lg:col-span-4 space-y-3 ${activePane === 'workbench' ? 'hidden lg:block' : ''}`}>
          <h2 className="text-xs font-semibold text-slate-450 uppercase tracking-wider px-1">
            Active System Agents ({agents.length})
          </h2>
          
          <div className="space-y-2.5">
            {agents.map((agent) => {
              const isSelected = selectedAgent?.id === agent.id;
              
              return (
                <Card
                  key={agent.id}
                  onClick={() => {
                    setSelectedAgent(agent);
                    initFormValues(agent);
                    setActivePane('workbench');
                    // Smooth scroll to settings workbench on mobile/tablet viewports
                    setTimeout(() => {
                      workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 50);
                  }}
                  className={`border-slate-800 bg-slate-900/40 backdrop-blur-sm cursor-pointer hover:bg-slate-900/60 transition-all ${
                    isSelected ? 'ring-1 ring-primary bg-slate-900/70 border-primary/40' : ''
                  }`}
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="space-y-0.5">
                      <CardTitle className="text-white text-sm font-semibold capitalize flex items-center gap-1.5">
                        {agent.role === 'supervisor' ? (
                          <Sparkles className="h-4 w-4 text-amber-400" />
                        ) : (
                          <Bot className="h-4 w-4 text-primary" />
                        )}
                        {agent.name}
                      </CardTitle>
                      <CardDescription className="text-xs text-slate-400 truncate max-w-[240px]">
                        Role: {agent.role}
                      </CardDescription>
                    </div>

                    <CardAction className="flex flex-col items-end gap-1 shrink-0">
                      {agent.status === 'active' ? (
                        <Badge className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs py-0.5 px-2">
                          Active
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-850 border border-slate-800 text-slate-400 text-xs py-0.5 px-2">
                          Inactive
                        </Badge>
                      )}
                      <span className="text-xs text-slate-400 font-mono">v{agent.current_version}</span>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="p-4 pt-1">
                    <p className="text-sm text-slate-300 leading-normal line-clamp-2">
                      {agent.description || 'No description provided.'}
                    </p>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-450">
                      <span>Model: <span className="font-mono text-slate-300">{agent.model}</span></span>
                      <span>Temp: <span className="font-mono text-slate-300">{agent.temperature}</span></span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Right Side: Selected Agent workbench */}
        <div ref={workbenchRef} className={`lg:col-span-8 scroll-mt-6 ${activePane === 'list' ? 'hidden lg:block' : ''}`}>
          {selectedAgent ? (
            <div className="space-y-4">
              {/* Back to Agents button — mobile/tablet only */}
              <div className="lg:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActivePane('list')}
                  className="text-slate-400 hover:text-white mb-2 pl-0 flex items-center gap-1.5"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Agents
                </Button>
              </div>
              
              {/* Agent Title block */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/20 border border-slate-800/80 p-4 rounded-xl backdrop-blur-md">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-white capitalize">{name}</h2>
                    <Badge variant="outline" className="border-slate-800 bg-slate-950 text-slate-300 text-xs px-2 py-0.5">
                      {selectedAgent.role}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-300">
                    {description || 'Workspace system agent role.'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeletingAgent(selectedAgent)}
                  className="border-slate-800 bg-slate-900 text-slate-400 hover:text-rose-400 hover:bg-slate-800 text-xs shrink-0 self-start sm:self-center"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Reset to Default
                </Button>
              </div>

              {/* Workbench Tabs */}
              <Tabs defaultValue="prompt" className="w-full">
                <div className="w-full overflow-x-auto scrollbar-none pb-1">
                  <TabsList className="flex h-fit w-max bg-slate-900 border border-slate-800 p-0.5 mb-4">
                    <TabsTrigger value="prompt" className="px-5 py-1.5 text-xs sm:text-sm">
                      <FileText className="h-4 w-4 mr-2" />
                      System Prompt
                    </TabsTrigger>
                    <TabsTrigger value="config" className="px-5 py-1.5 text-xs sm:text-sm">
                      <Sliders className="h-4 w-4 mr-2" />
                      Parameters & Tools
                    </TabsTrigger>
                    <TabsTrigger value="testing" className="px-5 py-1.5 text-xs sm:text-sm">
                      <Terminal className="h-4 w-4 mr-2" />
                      Sandbox Testing
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* Tab 1: System Prompt Editor & Rollback Versions */}
                <TabsContent value="prompt" className="space-y-4">
                  <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md">
                    <CardHeader className="pb-3 border-b border-slate-800/50 flex-row items-center justify-between">
                      <div>
                        <CardTitle className="text-white text-base">System Prompt Instructions</CardTitle>
                        <CardDescription className="text-xs text-slate-500">
                          Configure directives, personalities, and rules. System prompt updates generate new version logs.
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsPreviewOpen(true)}
                          className="border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                        >
                          Preview Prompt
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSavePrompt}
                          disabled={savingPrompt || !systemPrompt.trim()}
                          className="bg-primary text-primary-foreground hover:bg-primary/95"
                        >
                          {savingPrompt ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Save Prompt'
                          )}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-4">
                      {/* Editor Textarea */}
                      <Textarea
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        placeholder="Write agent system instructions here..."
                        className="min-h-[300px] font-mono text-xs leading-relaxed border-slate-800 bg-slate-950 text-slate-350 focus:ring-1 focus:ring-primary"
                      />

                      {/* Template Variables Helper */}
                      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-2">
                        <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                          <HelpCircle className="h-4 w-4 text-primary" />
                          Allowed Template Tags
                        </h4>
                        <p className="text-xs text-slate-300 leading-normal">
                          Wrap placeholders in curly braces. The agent loader automatically interpolates these variables with live customer CRM metadata before sending the prompt to the model.
                        </p>
                        
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2 text-xs">
                          {TEMPLATE_VARIABLES.map((v) => (
                            <div key={v.tag} className="border border-slate-850 p-2 rounded bg-slate-950 hover:bg-slate-900 transition-colors">
                              <span className="font-mono text-primary font-semibold block">{v.tag}</span>
                              <span className="text-slate-400 block mt-0.5">{v.desc}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Historical prompt versions list */}
                  <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md">
                    <CardHeader className="pb-3 border-b border-slate-800/50">
                      <CardTitle className="text-white text-sm flex items-center gap-1.5">
                        <History className="h-4 w-4 text-primary" />
                        Prompt Ingestion History
                      </CardTitle>
                      <CardDescription className="text-xs text-slate-500">
                        Tracks prompt revisions. Click any history node to trigger rollback.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      {loadingVersions ? (
                        <div className="flex h-36 items-center justify-center">
                          <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" />
                          <span className="text-xs text-slate-400">Loading version logs...</span>
                        </div>
                      ) : versions.length === 0 ? (
                        <div className="flex items-center justify-center h-24 text-slate-500 text-xs">
                          No previous versions found.
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-800/40">
                          {versions.map((ver) => (
                            <div key={ver.id} className="p-3.5 hover:bg-slate-800/10 flex items-center justify-between text-xs text-slate-300">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Badge className="bg-slate-850 text-slate-300 border border-slate-800 font-mono text-xs px-2 py-0.5">
                                    Version {ver.version}
                                  </Badge>
                                  {ver.version === selectedAgent.current_version && (
                                    <Badge className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs px-2 py-0.5">
                                      Active Version
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-xs text-slate-400 flex items-center gap-2">
                                  <span>Changed on {formatDate(ver.created_at)}</span>
                                </div>
                              </div>
                              
                              {ver.version !== selectedAgent.current_version && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setRollingVersion(ver)}
                                  className="h-8 text-slate-400 hover:text-white hover:bg-slate-850 text-xs flex items-center gap-1 border border-transparent hover:border-slate-800"
                                >
                                  <RotateCcw className="h-3 w-3" /> Rollback
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Tab 2: Configurations form & Tools selection */}
                <TabsContent value="config">
                  <form onSubmit={handleSaveConfig} className="space-y-4">
                    <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md">
                      <CardHeader className="pb-3 border-b border-slate-800/50">
                        <CardTitle className="text-white text-base">Model Parameters</CardTitle>
                        <CardDescription className="text-xs text-slate-500">
                          Set LLM parameters, temperature tolerances, and knowledge base scope.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-4 space-y-4 text-xs sm:text-sm">
                        
                        {/* Name & Desc */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-400">Agent Display Name</label>
                            <Input
                              required
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              className="border-slate-800 bg-slate-950 text-white text-sm sm:text-base"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-400">Description</label>
                            <Input
                              value={description}
                              onChange={(e) => setDescription(e.target.value)}
                              className="border-slate-800 bg-slate-950 text-white text-sm sm:text-base"
                            />
                          </div>
                        </div>

                        {/* Model & Temp */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                          <div className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-400">AI Model Provider</label>
                            <select
                              value={model}
                              onChange={(e) => setModel(e.target.value)}
                              className="w-full h-9 rounded-md border border-slate-800 bg-slate-950 px-2.5 text-sm sm:text-base text-slate-300 outline-none focus:ring-1 focus:ring-primary"
                            >
                              {MODELS.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <label className="font-medium text-slate-400">Temperature (Flakiness)</label>
                              <span className="font-mono text-primary font-semibold">{temperature}</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="1.0"
                              step="0.05"
                              value={temperature}
                              onChange={(e) => setTemperature(parseFloat(e.target.value))}
                              className="w-full accent-primary bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer mt-2"
                            />
                          </div>
                        </div>

                        {/* Switch Status & KB Access */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-850">
                          
                          <div className="flex items-center justify-between rounded-lg bg-slate-950/45 p-3.5 border border-slate-850">
                            <div className="space-y-1">
                              <span className="text-sm font-semibold text-white block">Status</span>
                              <span className="text-xs text-slate-400 block">Enable/Disable CRM WhatsApp routing.</span>
                            </div>
                            <select
                              value={status}
                              onChange={(e) => setStatus(e.target.value as any)}
                              className="h-9 rounded border border-slate-800 bg-slate-950 px-3 text-sm sm:text-base text-slate-300 outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                            </select>
                          </div>

                          <div className="flex items-center justify-between rounded-lg bg-slate-950/45 p-3.5 border border-slate-850">
                            <div className="space-y-1">
                              <span className="text-sm font-semibold text-white block">Knowledge Access (RAG)</span>
                              <span className="text-xs text-slate-400 block">Grant access to organizational documents.</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={kbAccess}
                              onChange={(e) => setKbAccess(e.target.checked)}
                              className="size-5 rounded accent-primary border-slate-800 bg-slate-950 cursor-pointer"
                            />
                          </div>

                        </div>
                      </CardContent>
                    </Card>

                    {/* Tools checkbox list */}
                    <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md">
                      <CardHeader className="pb-3 border-b border-slate-800/50">
                        <CardTitle className="text-white text-base">Allowed Tool Triggers</CardTitle>
                        <CardDescription className="text-xs text-slate-500">
                          Restrict database queries or message mutation tools available for the LLM during execution.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-4">
                        {tools.length === 0 ? (
                          <div className="text-xs text-slate-500 text-center py-4">
                            No tools registered in registry.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                            {tools.map((tool) => {
                              const isChecked = allowedTools.includes(tool.name);
                              
                              return (
                                <div
                                  key={tool.name}
                                  onClick={() => handleToolToggle(tool.name)}
                                  className={`border p-3.5 rounded-lg flex items-start gap-3 cursor-pointer transition-colors ${
                                    isChecked
                                      ? 'border-primary/45 bg-primary/5 hover:bg-primary/10'
                                      : 'border-slate-850 bg-slate-950/50 hover:bg-slate-950/80'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {}} // Handled by div click
                                    className="size-4 accent-primary shrink-0 mt-0.5 cursor-pointer"
                                  />
                                  <div className="space-y-1">
                                    <span className="font-mono text-white font-semibold block text-xs sm:text-sm">{tool.name}</span>
                                    <span className="text-slate-400 text-xs block leading-normal">{tool.description}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="mt-6 flex justify-end border-t border-slate-850 pt-4">
                          <Button
                            type="submit"
                            disabled={savingConfig}
                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                          >
                            {savingConfig ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              'Save Parameters & Tools'
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </form>
                </TabsContent>

                {/* Tab 3: Sandbox Testing Console */}
                <TabsContent value="testing" className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                    
                    {/* Input Console */}
                    <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md md:col-span-1">
                      <CardHeader className="pb-3 border-b border-slate-800/50">
                        <CardTitle className="text-white text-sm">Testing Panel</CardTitle>
                        <CardDescription className="text-xs text-slate-500">
                          Verify tool classifications and responses under this configuration.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-4">
                        <form onSubmit={handleRunTest} className="space-y-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-400">Test User Message</label>
                            <Textarea
                              required
                              placeholder="e.g. Can you update me on quote total amount?"
                              value={testMessage}
                              onChange={(e) => setTestMessage(e.target.value)}
                              className="border-slate-800 bg-slate-950 text-white min-h-[80px] text-xs placeholder:text-slate-650"
                            />
                          </div>

                          {testError && (
                            <div className="flex items-center gap-1.5 rounded border border-rose-500/20 bg-rose-500/10 p-2.5 text-rose-400 text-[11px]">
                              <AlertCircle className="h-4 w-4 shrink-0" />
                              <p className="leading-tight">{testError}</p>
                            </div>
                          )}

                          <Button
                            type="submit"
                            disabled={testing || !testMessage.trim()}
                            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
                          >
                            {testing ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Analyzing...
                              </>
                            ) : (
                              <>
                                <Play className="h-3.5 w-3.5 mr-1.5" />
                                Run Test Sandbox
                              </>
                            )}
                          </Button>
                        </form>
                      </CardContent>
                    </Card>

                    {/* Results Console */}
                    <div className="md:col-span-2 space-y-4">
                      <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md min-h-[300px]">
                        <CardHeader className="pb-3 border-b border-slate-800/50">
                          <CardTitle className="text-white text-sm flex items-center gap-1.5">
                            <Terminal className="h-4 w-4 text-primary" />
                            LLM Response Output
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4">
                          {testing ? (
                            <div className="flex flex-col items-center justify-center p-12 text-slate-500 text-xs gap-2">
                              <Loader2 className="h-6 w-6 animate-spin text-primary" />
                              <span>Interpolating variables and checking tool call triggers...</span>
                            </div>
                          ) : !testResult ? (
                            <div className="text-xs text-slate-500 text-center py-12">
                              Input a test message and run the sandbox console.
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {/* Text generation */}
                              <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-850">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Final Output Message</h4>
                                <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                                  {testResult.text || '(No text returned by model)'}
                                </p>
                              </div>

                              {/* Tool calls */}
                              {testResult.toolCalls && testResult.toolCalls.length > 0 && (
                                <div className="space-y-2">
                                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Triggered Tool Calls ({testResult.toolCalls.length})</h4>
                                  
                                  {testResult.toolCalls.map((tc, idx) => (
                                    <div key={idx} className="border border-amber-500/25 bg-amber-500/5 rounded-lg p-3 text-sm">
                                      <div className="flex items-center gap-1 text-amber-400 font-semibold font-mono">
                                        <ChevronRight className="h-3.5 w-3.5" />
                                        <span>{tc.name}</span>
                                      </div>
                                      <pre className="mt-2 text-xs font-mono text-slate-350 overflow-x-auto bg-slate-950 p-2.5 rounded">
                                        {JSON.stringify(tc.args, null, 2)}
                                      </pre>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Interpolated Prompt collapsible */}
                              <div className="rounded-lg border border-slate-850 overflow-hidden">
                                <details className="group">
                                  <summary className="bg-slate-950/60 p-2.5 text-xs text-slate-300 hover:text-white cursor-pointer select-none font-medium flex justify-between items-center">
                                    <span>Review Interpolated System Prompt</span>
                                    <span className="text-xs text-slate-400">(Variables replaced with contact &apos;{testResult.contextUsed?.customerName}&apos;)</span>
                                  </summary>
                                  <div className="p-3.5 border-t border-slate-850 bg-slate-950 font-mono text-xs text-slate-350 whitespace-pre-wrap leading-normal max-h-60 overflow-y-auto">
                                    {testResult.interpolatedPrompt}
                                  </div>
                                </details>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>

                  </div>
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md p-12 text-center text-slate-400">
              <Bot className="h-10 w-10 mx-auto text-slate-655 mb-2 animate-pulse" />
              <p className="text-sm font-semibold">Select an agent</p>
              <p className="text-xs text-slate-500 mt-1">
                Choose one of the core system agents from the left list to begin prompt engineering.
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* Prompt Preview Modal (Radix Dialog) */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="border-slate-800 bg-slate-900 text-white max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="text-white text-base flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Prompt Template Preview
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-450">
              Preview system instructions with placeholder tags compiled using sample contact profile details.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[350px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-350 whitespace-pre-wrap leading-normal">
            {interpolatedPreviewPrompt || '(Prompt is empty)'}
          </div>

          <DialogFooter className="mt-4 flex sm:justify-end">
            <Button
              type="button"
              onClick={() => setIsPreviewOpen(false)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
            >
              Close Preview
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback Prompt Modal (Radix Dialog) */}
      <Dialog open={!!rollingVersion} onOpenChange={(open) => !open && setRollingVersion(null)}>
        <DialogContent className="border-slate-800 bg-slate-900 text-white max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="text-white text-base flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-400" />
              Rollback System Prompt?
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              This will update the active prompt instructions to the content of Version {rollingVersion?.version}. This rollback is logged as a new sequential version.
            </DialogDescription>
          </DialogHeader>

          {rollingVersion && (
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs">
              <div className="font-semibold text-white">Target Version: Version {rollingVersion.version}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Created at: {formatDate(rollingVersion.created_at)}</div>
              <div className="mt-2 text-[10px] font-mono text-slate-400 line-clamp-3 border-t border-slate-850 pt-2 whitespace-pre-wrap">
                {rollingVersion.system_prompt}
              </div>
            </div>
          )}

          <DialogFooter className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRollingVersion(null)}
              className="border-slate-800 text-slate-300 hover:bg-slate-850 hover:text-white"
              disabled={isRolling}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleRollbackConfirm}
              className="bg-primary text-primary-foreground hover:bg-primary/95"
              disabled={isRolling}
            >
              {isRolling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Rolling back...
                </>
              ) : (
                'Rollback System Prompt'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete / Reset Configuration Modal (Radix Dialog) */}
      <Dialog open={!!deletingAgent} onOpenChange={(open) => !open && setDeletingAgent(null)}>
        <DialogContent className="border-slate-800 bg-slate-900 text-white max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="text-rose-400 text-base flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Reset Agent to Default?
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-450">
              This will completely wipe out the current configuration, version history logs, and prompt revisions for this agent role. Upon dashboard refresh, a clean slate default template will be seeded.
            </DialogDescription>
          </DialogHeader>

          {deletingAgent && (
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs">
              <div className="font-semibold text-white">{deletingAgent.name}</div>
              <div className="text-slate-500 mt-0.5 font-mono">Role: {deletingAgent.role}</div>
            </div>
          )}

          <DialogFooter className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletingAgent(null)}
              className="border-slate-800 text-slate-300 hover:bg-slate-850 hover:text-white"
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDeleteConfirm}
              className="bg-rose-600 hover:bg-rose-500 text-white"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Resetting...
                </>
              ) : (
                'Confirm Reset'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
