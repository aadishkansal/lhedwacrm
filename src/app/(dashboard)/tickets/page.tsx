"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { format } from "date-fns";
import {
  AlertCircle,
  Clock,
  CheckCircle2,
  User,
  Search,
  MessageSquare,
  ArrowUpRight,
  Loader2,
  Filter,
  RefreshCw
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import type { Profile } from "@/types";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface Ticket {
  id: string;
  title: string;
  status: "open" | "resolved" | "closed";
  priority: "low" | "medium" | "high";
  category: string;
  assigned_agent_id: string | null;
  created_at: string;
  updated_at: string;
  commentCount: number;
  conversationId: string | null;
  contact: {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
  } | null;
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentUser, setCurrentUser] = useState<SupabaseUser | null>(null);

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tickets");
      if (!res.ok) throw new Error("Failed to fetch tickets");
      const data = await res.json();
      setTickets(data.tickets || []);
    } catch (err: unknown) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      toast.error("Failed to load tickets: " + errMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const setupData = async () => {
      const supabase = createClient();
      
      // Fetch user session
      const { data: { session } } = await supabase.auth.getSession();
      setCurrentUser(session?.user || null);

      // Fetch profiles
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name", { ascending: true });
      if (data) setProfiles(data as Profile[]);

      await fetchTickets();
    };

    setupData();
  }, [fetchTickets]);

  // Compute Metrics
  const metrics = useMemo(() => {
    const counts = { open: 0, pending: 0, resolved: 0, closed: 0, total: 0 };
    tickets.forEach((t) => {
      counts.total++;
      if (t.status === "open") counts.open++;
      else if (t.status === "resolved") counts.resolved++;
      else if (t.status === "closed") counts.closed++;
    });
    return counts;
  }, [tickets]);

  // Filter tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      // 1. Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = t.title.toLowerCase().includes(q);
        const contactNameMatch = t.contact?.name?.toLowerCase().includes(q) || false;
        const contactPhoneMatch = t.contact?.phone?.toLowerCase().includes(q) || false;
        if (!titleMatch && !contactNameMatch && !contactPhoneMatch) return false;
      }

      // 2. Status filter
      if (statusFilter !== "all" && t.status !== statusFilter) return false;

      // 3. Priority filter
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;

      // 4. Category filter
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;

      // 5. Assignee filter
      if (assigneeFilter !== "all") {
        if (assigneeFilter === "unassigned" && t.assigned_agent_id !== null) return false;
        if (assigneeFilter === "me" && t.assigned_agent_id !== currentUser?.id) return false;
        if (assigneeFilter !== "unassigned" && assigneeFilter !== "me" && t.assigned_agent_id !== assigneeFilter) return false;
      }

      return true;
    });
  }, [tickets, searchQuery, statusFilter, priorityFilter, categoryFilter, assigneeFilter, currentUser]);

  const handleResetFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setCategoryFilter("all");
    setAssigneeFilter("all");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tickets</h1>
          <p className="text-sm text-slate-400 mt-1">
            Overview of all customer support tickets across your organization.
          </p>
        </div>
        <div>
          <Button
            variant="outline"
            onClick={fetchTickets}
            disabled={loading}
            className="w-full sm:w-auto border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-850 bg-slate-900/60 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Tickets</span>
            <AlertCircle className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-white">{metrics.total}</p>
        </div>
        <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-500/80">Open Tickets</span>
            <AlertCircle className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-emerald-400">{metrics.open}</p>
        </div>
        <div className="rounded-xl border border-sky-500/10 bg-sky-500/5 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sky-500/80">Resolved Tickets</span>
            <CheckCircle2 className="h-4 w-4 text-sky-400" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-sky-400">{metrics.resolved}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Closed Tickets</span>
            <Clock className="h-4 w-4 text-slate-500" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-400">{metrics.closed}</p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="rounded-xl border border-slate-850 bg-slate-900/30 p-4 space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <Filter className="h-3.5 w-3.5" />
          Filter & Search
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          {/* Search */}
          <div className="relative sm:col-span-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tickets, contact..."
              className="pl-8 bg-slate-950 border-slate-800 text-white placeholder:text-slate-500 text-xs h-9"
            />
          </div>

          {/* Status */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs text-slate-300 outline-none focus:border-primary/50 h-9"
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          {/* Priority */}
          <div>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs text-slate-300 outline-none focus:border-primary/50 h-9"
            >
              <option value="all">All Priorities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          {/* Category */}
          <div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs text-slate-300 outline-none focus:border-primary/50 h-9"
            >
              <option value="all">All Categories</option>
              <option value="general">General</option>
              <option value="billing">Billing</option>
              <option value="technical">Technical</option>
              <option value="installation">Installation</option>
              <option value="sales">Sales</option>
            </select>
          </div>

          {/* Assignee */}
          <div>
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs text-slate-300 outline-none focus:border-primary/50 h-9"
            >
              <option value="all">All Assignees</option>
              <option value="unassigned">Unassigned</option>
              <option value="me">Assigned to Me</option>
              {profiles.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {(searchQuery || statusFilter !== "all" || priorityFilter !== "all" || categoryFilter !== "all" || assigneeFilter !== "all") && (
          <div className="flex justify-end">
            <button
              onClick={handleResetFilters}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>

      {/* Tickets List Table */}
      <div className="rounded-xl border border-slate-850 overflow-x-auto bg-slate-950/20">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-850 hover:bg-transparent">
              <TableHead className="text-slate-400 text-xs">Ticket Details</TableHead>
              <TableHead className="text-slate-400 text-xs">Customer</TableHead>
              <TableHead className="text-slate-400 text-xs">Priority</TableHead>
              <TableHead className="text-slate-400 text-xs">Status</TableHead>
              <TableHead className="text-slate-400 text-xs">Assigned Agent</TableHead>
              <TableHead className="text-slate-400 text-xs">Comments</TableHead>
              <TableHead className="text-slate-400 text-xs">Created At</TableHead>
              <TableHead className="text-slate-400 text-xs w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-slate-850 hover:bg-transparent">
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-xs text-slate-500">Loading support tickets...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredTickets.length === 0 ? (
              <TableRow className="border-slate-850 hover:bg-transparent">
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle className="h-8 w-8 text-slate-600" />
                    <p className="text-xs text-slate-500 font-medium">No tickets found.</p>
                    <p className="text-[11px] text-slate-600">Try adjusting your filter settings or search query.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredTickets.map((t) => {
                const assignee = profiles.find((p) => p.user_id === t.assigned_agent_id);
                const customerName = t.contact?.name || "Unknown Customer";
                
                return (
                  <TableRow key={t.id} className="border-slate-850 hover:bg-slate-900/20">
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="text-xs font-semibold text-white leading-normal max-w-md truncate">{t.title}</p>
                        <span className="inline-block text-[10px] text-slate-400 capitalize bg-slate-850 px-1.5 py-0.5 rounded">
                          {t.category || "general"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-slate-200">{customerName}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{t.contact?.phone}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 capitalize",
                          t.priority === "high" && "bg-rose-500/10 text-rose-400 border-rose-500/20",
                          t.priority === "medium" && "bg-amber-500/10 text-amber-400 border-amber-500/20",
                          t.priority === "low" && "bg-slate-500/10 text-slate-400 border-slate-500/20"
                        )}
                      >
                        {t.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 capitalize",
                          t.status === "open" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                          t.status === "resolved" && "bg-blue-500/10 text-blue-400 border-blue-500/20",
                          t.status === "closed" && "bg-slate-500/10 text-slate-400 border-slate-500/20"
                        )}
                      >
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-300">
                      {t.assigned_agent_id ? (
                        <div className="flex items-center gap-1.5">
                          <User className="h-3 w-3 text-slate-500" />
                          <span>{assignee?.full_name || "Teammate"}</span>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {t.commentCount > 0 ? (
                        <div className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3 text-slate-500" />
                          <span>{t.commentCount} notes</span>
                        </div>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {format(new Date(t.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      {t.conversationId ? (
                        <Link href={`/inbox?c=${t.conversationId}`}>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="Open conversation thread"
                            className="text-slate-400 hover:text-white hover:bg-slate-800"
                          >
                            <ArrowUpRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled
                          title="No conversation thread found"
                          className="text-slate-700"
                        >
                          <ArrowUpRight className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
