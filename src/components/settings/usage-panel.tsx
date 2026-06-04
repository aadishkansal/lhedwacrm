'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, MessageSquare, Bot, AlertCircle, ExternalLink, Cpu, BarChart3, Database } from 'lucide-react';

interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  cost: number;
  count: number;
  provider: string;
}

interface UsageData {
  whatsapp: {
    config: {
      phone_number_id: string;
      waba_id: string | null;
      status: string;
      messaging_limit: string;
    } | null;
    stats: {
      total: number;
      customer: number;
      agent: number;
      bot: number;
      templates: number;
    };
    cost: {
      totalEstimatedCost: number;
      billingCycleCost: number;
    };
  };
  llm: {
    totalExecutions: number;
    failedExecutions: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCost: number;
    byModel: Record<string, ModelUsage>;
  };
}

export function UsagePanel() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/usage');
      if (!res.ok) {
        throw new Error('Failed to retrieve usage stats');
      }
      const usage = await res.json();
      setData(usage);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An error occurred loading usage metrics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-slate-400">Compiling organization usage telemetry...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center p-8 border border-rose-500/20 bg-rose-500/10 rounded-xl text-rose-400 gap-3">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm font-semibold">{error || 'Failed to load usage data.'}</p>
        <Button variant="outline" size="sm" onClick={fetchUsage} className="border-rose-500/30 text-rose-450 hover:bg-rose-500/20 hover:text-white">
          Retry Loading
        </Button>
      </div>
    );
  }

  const { whatsapp, llm } = data;

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h3 className="text-lg font-medium text-white flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Usage & Telemetry
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Monitor your WhatsApp Business messaging volumes and LLM API costs in real-time.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* CARD 1: WhatsApp Usage */}
        <Card className="bg-slate-900/40 border-slate-800/80 hover:border-emerald-800/30 hover:bg-slate-900/60 transition-all duration-200">
          <CardHeader className="border-b border-slate-850 pb-4 bg-gradient-to-r from-emerald-100/40 dark:from-emerald-950/20 to-transparent">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2 text-base">
                <MessageSquare className="h-5 w-5 text-emerald-400" />
                WhatsApp Channel
              </CardTitle>
              {whatsapp.config ? (
                <Badge className="bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs py-0.5 px-2">
                  Connected
                </Badge>
              ) : (
                <Badge className="bg-slate-800 border border-slate-700 text-slate-400 text-xs py-0.5 px-2">
                  Unconfigured
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs text-slate-450">
              WhatsApp Business Account limits, message metrics, and billing.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-5">
            {/* Meta Config Info */}
            <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-4 space-y-2.5">
              <div className="flex justify-between text-xs border-b border-slate-900 pb-2">
                <span className="text-slate-450">Phone Number ID</span>
                <span className="font-mono text-slate-200">{whatsapp.config?.phone_number_id || '—'}</span>
              </div>
              <div className="flex justify-between text-xs border-b border-slate-900 pb-2">
                <span className="text-slate-450">WABA ID</span>
                <span className="font-mono text-slate-200">{whatsapp.config?.waba_id || '—'}</span>
              </div>
              <div className="flex justify-between text-xs pt-0.5">
                <span className="text-slate-450">Messaging Limit</span>
                <span className="font-medium text-emerald-400">{whatsapp.config?.messaging_limit || 'N/A'}</span>
              </div>
            </div>

            {/* WhatsApp Cost Estimates */}
            <div className="grid grid-cols-2 gap-4 bg-gradient-to-br from-emerald-100/30 dark:from-emerald-950/20 to-slate-950/40 border border-emerald-900/15 rounded-xl p-4">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Billing Cycle (Month)</span>
                <span className="text-lg font-bold text-emerald-400 font-mono block">
                  ${whatsapp.cost?.billingCycleCost.toFixed(2) || '0.00'}
                </span>
                <span className="text-[9px] text-slate-500 block">Est. template charges</span>
              </div>
              <div className="space-y-1 text-right">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Estimated Cost</span>
                <span className="text-lg font-bold text-emerald-350 font-mono block">
                  ${whatsapp.cost?.totalEstimatedCost.toFixed(2) || '0.00'}
                </span>
                <span className="text-[9px] text-slate-500 block">All-time template fees</span>
              </div>
            </div>

            {/* Metrics */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Message Log Statistics</h4>
              
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="border border-slate-850 bg-slate-950/40 p-3 rounded-lg text-center space-y-1">
                  <span className="text-slate-500 block text-[10px] uppercase">Total Volume</span>
                  <span className="text-base font-bold text-white font-mono">{whatsapp.stats.total}</span>
                </div>
                <div className="border border-slate-850 bg-slate-950/40 p-3 rounded-lg text-center space-y-1">
                  <span className="text-slate-500 block text-[10px] uppercase">Templates Sent</span>
                  <span className="text-base font-bold text-white font-mono">{whatsapp.stats.templates}</span>
                </div>
                <div className="border border-slate-850 bg-slate-950/40 p-3 rounded-lg text-center space-y-1">
                  <span className="text-slate-500 block text-[10px] uppercase">Received (Customer)</span>
                  <span className="text-base font-bold text-slate-300 font-mono">{whatsapp.stats.customer}</span>
                </div>
                <div className="border border-slate-850 bg-slate-950/40 p-3 rounded-lg text-center space-y-1">
                  <span className="text-slate-500 block text-[10px] uppercase">Sent (AI Bot)</span>
                  <span className="text-base font-bold text-primary font-mono">{whatsapp.stats.bot}</span>
                </div>
              </div>
            </div>

            {/* Billing Button */}
            <div className="pt-2 border-t border-slate-850">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open('https://business.facebook.com/', '_blank')}
                className="w-full text-xs border-slate-800 bg-slate-950 text-slate-400 hover:text-white hover:bg-slate-900"
              >
                Manage Meta Billing
                <ExternalLink className="h-3.5 w-3.5 ml-1.5 shrink-0" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* CARD 2: AI / LLM API Usage */}
        <Card className="bg-slate-900/40 border-slate-800/80 hover:border-purple-800/30 hover:bg-slate-900/60 transition-all duration-200">
          <CardHeader className="border-b border-slate-850 pb-4 bg-gradient-to-r from-purple-100/40 dark:from-purple-950/20 to-transparent">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2 text-base">
                <Cpu className="h-5 w-5 text-purple-400" />
                AI Foundation API
              </CardTitle>
              <Badge className="bg-purple-500/10 border border-purple-500/25 text-purple-400 text-xs py-0.5 px-2">
                Active (LLM)
              </Badge>
            </div>
            <CardDescription className="text-xs text-slate-450">
              Token consumption and aggregated API endpoint costs.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-5">
            {/* Total Cost Block */}
            <div className="bg-gradient-to-br from-purple-100/30 dark:from-purple-950/20 to-slate-950/40 border border-purple-900/15 rounded-xl p-4 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-xs text-slate-400 uppercase font-semibold">Total LLM Charges</span>
                <span className="text-xs text-slate-500 block leading-tight">Accrued agent call costs</span>
              </div>
              <div className="text-right">
                <span className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-500 dark:from-purple-400 dark:to-indigo-300 font-mono">
                  ${llm.totalCost.toFixed(5)}
                </span>
                <span className="text-[10px] text-slate-500 block font-mono">USD</span>
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="border border-slate-850 bg-slate-950/40 p-2.5 rounded-lg text-center space-y-1">
                <span className="text-slate-500 block text-[9px] uppercase">Calls</span>
                <span className="text-sm font-bold text-white font-mono">
                  {llm.totalExecutions}
                </span>
              </div>
              <div className="border border-slate-850 bg-slate-950/40 p-2.5 rounded-lg text-center space-y-1">
                <span className="text-slate-500 block text-[9px] uppercase">Tokens</span>
                <span className="text-sm font-bold text-white font-mono">
                  {((llm.totalPromptTokens + llm.totalCompletionTokens) / 1000).toFixed(1)}k
                </span>
              </div>
              <div className="border border-slate-850 bg-slate-950/40 p-2.5 rounded-lg text-center space-y-1">
                <span className="text-slate-500 block text-[9px] uppercase">Failed</span>
                <span className={`text-sm font-bold font-mono ${llm.failedExecutions > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                  {llm.failedExecutions}
                </span>
              </div>
            </div>

            {/* Model Breakdown */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-1">
                <Database className="h-3.5 w-3.5 text-primary" />
                Breakdown by Model
              </h4>

              {Object.keys(llm.byModel).length === 0 ? (
                <div className="text-xs text-slate-500 text-center py-2 bg-slate-950/30 rounded border border-slate-900">
                  No LLM usage registered.
                </div>
              ) : (
                <div className="border border-slate-850 bg-slate-950/30 rounded-xl overflow-hidden text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-950/80 border-b border-slate-850 text-slate-500 text-[10px] font-semibold uppercase">
                        <th className="p-2.5">Model</th>
                        <th className="p-2.5 text-center">Calls</th>
                        <th className="p-2.5 text-right">Tokens</th>
                        <th className="p-2.5 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850/50">
                      {Object.entries(llm.byModel).map(([modelName, stats]) => (
                        <tr key={modelName} className="hover:bg-slate-950/20 text-slate-300">
                          <td className="p-2.5">
                            <span className="font-mono text-white block">{modelName}</span>
                            <span className="text-[10px] text-slate-500 capitalize font-medium">{stats.provider}</span>
                          </td>
                          <td className="p-2.5 text-center font-mono">{stats.count}</td>
                          <td className="p-2.5 text-right font-mono text-slate-400">
                            {((stats.promptTokens + stats.completionTokens) / 1000).toFixed(1)}k
                          </td>
                          <td className="p-2.5 text-right font-mono text-purple-400 font-semibold">
                            ${stats.cost.toFixed(5)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
