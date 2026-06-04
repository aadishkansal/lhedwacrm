"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ContactNote, Tag, Conversation } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  X,
  History,
  Info,
  Calendar,
  Clock,
  UserCheck,
  RefreshCw,
  MessageCircle,
  AlertTriangle,
  Combine,
  Cpu,
  FileText,
  AlertCircle,
  Zap,
  Hammer,
  ChevronDown,
  ChevronUp,
  Search
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { toast } from "sonner";
import { SheetClose } from "@/components/ui/sheet";

interface ContactSidebarProps {
  contact: Contact | null;
  conversation?: Conversation | null;
  onRefresh?: () => void;
  isMobile?: boolean;
}

export function ContactSidebar({ contact, conversation, onRefresh, isMobile = false }: ContactSidebarProps) {
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  
  // Tab view: details vs timeline vs tickets
  const [activeTab, setActiveTab] = useState<"details" | "timeline" | "tickets">("details");
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  // Unified Timeline States
  const [timelineFilter, setTimelineFilter] = useState<"all" | "message" | "crm" | "ai" | "system">("all");
  const [timelineSearch, setTimelineSearch] = useState("");
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});

  // Ticketing System States
  const [tickets, setTickets] = useState<any[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    priority: "medium",
    category: "general",
    assignedAgentId: "",
    initialNote: "",
  });
  const [profiles, setProfiles] = useState<any[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketComments, setTicketComments] = useState<Record<string, any[]>>({});
  const [newCommentText, setNewCommentText] = useState<Record<string, string>>({});
  const [submittingComment, setSubmittingComment] = useState<Record<string, boolean>>({});
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [submittingResolution, setSubmittingResolution] = useState<Record<string, boolean>>({});
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, any>>({});
  const [loadingAiAnalysis, setLoadingAiAnalysis] = useState<Record<string, boolean>>({});
  const [suggestedReplies, setSuggestedReplies] = useState<Record<string, string>>({});
  const [loadingSuggestedReply, setLoadingSuggestedReply] = useState<Record<string, boolean>>({});

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, tags, and all available organization tags in parallel
    const [dealsRes, notesRes, tagsRes, allTagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase
        .from("tags")
        .select("*")
        .order("name"),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: any) => ct.tags)
        .map((ct: any) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
    if (allTagsRes.data) setAllTags(allTagsRes.data);
  }, [contact]);

  const fetchTimeline = useCallback(async () => {
    if (!conversation?.id) return;
    setLoadingTimeline(true);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/timeline`);
      if (!res.ok) throw new Error("Failed to load timeline");
      const data = await res.json();
      setTimelineEvents(data.events || []);
    } catch (err: any) {
      console.error("Timeline load failed:", err.message);
    } finally {
      setLoadingTimeline(false);
    }
  }, [conversation?.id]);

  const fetchTickets = useCallback(async () => {
    if (!contact?.id) return;
    setLoadingTickets(true);
    try {
      const res = await fetch(`/api/tickets?contactId=${contact.id}`);
      if (!res.ok) throw new Error("Failed to load tickets");
      const data = await res.json();
      setTickets(data.tickets || []);
    } catch (err: any) {
      console.error("Tickets load failed:", err.message);
    } finally {
      setLoadingTickets(false);
    }
  }, [contact?.id]);

  const fetchTicketComments = useCallback(async (ticketId: string) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/comments`);
      if (!res.ok) throw new Error("Failed to load comments");
      const data = await res.json();
      setTicketComments((prev) => ({ ...prev, [ticketId]: data.comments || [] }));
    } catch (err: any) {
      console.error("Comments load failed:", err.message);
    }
  }, []);

  const handleTicketExpand = useCallback((ticketId: string) => {
    if (selectedTicketId === ticketId) {
      setSelectedTicketId(null);
    } else {
      setSelectedTicketId(ticketId);
      fetchTicketComments(ticketId);
    }
  }, [selectedTicketId, fetchTicketComments]);

  const handleCreateTicket = async () => {
    if (!contact?.id || !createForm.title.trim()) return;
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: contact.id,
          title: createForm.title.trim(),
          priority: createForm.priority,
          category: createForm.category,
          assignedAgentId: createForm.assignedAgentId || null,
          initialNote: createForm.initialNote.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed to create ticket");
      toast.success("Ticket created");
      setIsCreateDialogOpen(false);
      setCreateForm({ title: "", priority: "medium", category: "general", assignedAgentId: "", initialNote: "" });
      fetchTickets();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleUpdateTicketField = async (ticketId: string, fields: any) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error("Failed to update ticket");
      toast.success("Ticket updated");
      fetchTickets();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleResolveTicket = async (ticketId: string) => {
    const notesText = resolutionNotes[ticketId]?.trim();
    if (!notesText) {
      toast.error("Please enter resolution notes before resolving");
      return;
    }
    setSubmittingResolution(prev => ({ ...prev, [ticketId]: true }));
    try {
      await handleUpdateTicketField(ticketId, {
        status: "resolved",
        resolutionNotes: notesText,
      });
      setResolutionNotes(prev => ({ ...prev, [ticketId]: "" }));
    } finally {
      setSubmittingResolution(prev => ({ ...prev, [ticketId]: false }));
    }
  };

  const handleAddComment = async (ticketId: string) => {
    const content = newCommentText[ticketId]?.trim();
    if (!content) return;
    setSubmittingComment(prev => ({ ...prev, [ticketId]: true }));
    try {
      const res = await fetch(`/api/tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, isInternal: true }),
      });
      if (!res.ok) throw new Error("Failed to add note");
      toast.success("Internal note added");
      setNewCommentText(prev => ({ ...prev, [ticketId]: "" }));
      fetchTicketComments(ticketId);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmittingComment(prev => ({ ...prev, [ticketId]: false }));
    }
  };

  const handleAnalyzeTicketAI = async (ticketId: string, description: string) => {
    setLoadingAiAnalysis(prev => ({ ...prev, [ticketId]: true }));
    try {
      const res = await fetch("/api/tickets/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: description }),
      });
      if (!res.ok) throw new Error("AI analysis failed");
      const data = await res.json();
      setAiSuggestions(prev => ({ ...prev, [ticketId]: data.analysis }));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoadingAiAnalysis(prev => ({ ...prev, [ticketId]: false }));
    }
  };

  const handleSuggestReplyAI = async (ticketId: string) => {
    setLoadingSuggestedReply(prev => ({ ...prev, [ticketId]: true }));
    try {
      const res = await fetch(`/api/tickets/${ticketId}/suggest-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("AI reply suggestion failed");
      const data = await res.json();
      setSuggestedReplies(prev => ({ ...prev, [ticketId]: data.suggestion }));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoadingSuggestedReply(prev => ({ ...prev, [ticketId]: false }));
    }
  };

  const handleCopyToComposer = (reply: string) => {
    window.dispatchEvent(new CustomEvent("message-composer:set-text", { detail: reply }));
    toast.success("Copied to message composer!");
  };

  useEffect(() => {
    const fetchProfiles = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name", { ascending: true });
      if (data) setProfiles(data);
    };
    fetchProfiles();
  }, []);

  useEffect(() => {
    fetchContactData();
    if (activeTab === "timeline") {
      fetchTimeline();
    } else if (activeTab === "tickets") {
      fetchTickets();
    }
  }, [fetchContactData, fetchTimeline, fetchTickets, activeTab]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setAddingNote(false);
      return;
    }

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        user_id: user.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
      toast.success("Note added");

      // Log note added event in timeline if conversation is open
      if (conversation?.id) {
        // Resolve orgUser
        const { data: orgUser } = await supabase
          .from("organization_users")
          .select("organization_id")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle();

        if (orgUser) {
          await supabase.from("inbox_timeline_events").insert({
            organization_id: orgUser.organization_id,
            conversation_id: conversation.id,
            event_type: "note_added",
            metadata: {
              note_text: data.note_text,
              note_id: data.id,
              added_by: user.id,
            },
            created_by: user.id,
          });
          if (activeTab === "timeline") {
            fetchTimeline();
          }
        }
      }
    } else if (error) {
      toast.error(`Failed to add note: ${error.message}`);
    }
    setAddingNote(false);
  }, [contact, newNote, conversation, activeTab, fetchTimeline]);

  const handleAddTag = useCallback(async (tagId: string) => {
    if (!contact || !tagId) return;
    try {
      const res = await fetch(`/api/contacts/${contact.id}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add tag");
      }
      toast.success("Tag added");
      fetchContactData();
      if (activeTab === "timeline") {
        fetchTimeline();
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [contact, fetchContactData, activeTab, fetchTimeline]);

  const handleRemoveTag = useCallback(async (tagId: string) => {
    if (!contact || !tagId) return;
    try {
      const res = await fetch(`/api/contacts/${contact.id}/tags?tagId=${tagId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to remove tag");
      }
      toast.success("Tag removed");
      fetchContactData();
      if (activeTab === "timeline") {
        fetchTimeline();
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [contact, fetchContactData, activeTab, fetchTimeline]);

  // Tags available to add (not currently on this contact)
  const availableTags = useMemo(() => {
    const activeIds = new Set(tags.map(t => t.id));
    return allTags.filter(t => !activeIds.has(t.id));
  }, [allTags, tags]);

  const toggleExpandEvent = useCallback((eventId: string) => {
    setExpandedEvents(prev => ({
      ...prev,
      [eventId]: !prev[eventId]
    }));
  }, []);

  const filteredTimelineEvents = useMemo(() => {
    let result = timelineEvents;

    if (timelineFilter !== "all") {
      result = result.filter(e => e.category === timelineFilter);
    }

    if (timelineSearch.trim()) {
      const q = timelineSearch.toLowerCase();
      result = result.filter(e => {
        const titleMatch = e.title?.toLowerCase().includes(q);
        const descMatch = e.description?.toLowerCase().includes(q);
        const metaMatch = e.metadata ? JSON.stringify(e.metadata).toLowerCase().includes(q) : false;
        return titleMatch || descMatch || metaMatch;
      });
    }

    return result;
  }, [timelineEvents, timelineFilter, timelineSearch]);

  if (!contact) {
    return (
      <div className="flex h-full w-full lg:w-80 items-center justify-center border-l border-slate-800 bg-slate-900">
        <p className="text-sm text-slate-500">Select a conversation</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  // Render a single timeline event
  const renderTimelineEvent = (event: any) => {
    const dateStr = format(new Date(event.created_at), "MMM d, HH:mm");
    const creatorName = event.creator?.full_name || "System";
    const isExpanded = !!expandedEvents[event.id];

    let icon = <History className="h-3 w-3 text-slate-400" />;
    let title = event.title || "";
    let description = event.description || "";
    
    switch (event.event_type) {
      case "status_change":
        icon = <RefreshCw className="h-3 w-3 text-sky-400" />;
        break;
      case "assignment_change":
        icon = <UserCheck className="h-3 w-3 text-indigo-400" />;
        break;
      case "note_added":
        icon = <StickyNote className="h-3 w-3 text-amber-400" />;
        break;
      case "tag_added":
        icon = <TagIcon className="h-3 w-3 text-emerald-400" />;
        break;
      case "tag_removed":
        icon = <X className="h-3 w-3 text-rose-400" />;
        break;
      case "message_sent":
        icon = <MessageCircle className="h-3 w-3 text-emerald-500" />;
        break;
      case "ai_escalated":
        icon = <AlertTriangle className="h-3 w-3 text-amber-500" />;
        break;
      case "conversation_merged":
        icon = <Combine className="h-3 w-3 text-purple-400" />;
        break;
      case "message":
        const isCustomer = event.metadata?.sender_type === "customer";
        icon = <MessageCircle className={cn("h-3 w-3", isCustomer ? "text-blue-400" : "text-emerald-500")} />;
        break;
      case "tool_call":
        icon = <Cpu className={cn("h-3 w-3", event.metadata?.status === "failed" ? "text-rose-500" : "text-purple-400")} />;
        break;
      case "proposal_event":
        icon = <DollarSign className="h-3 w-3 text-emerald-400" />;
        break;
      case "project_event":
        icon = <Hammer className="h-3 w-3 text-sky-400" />;
        break;
      case "installation_event":
        icon = <Calendar className="h-3 w-3 text-amber-400" />;
        break;
      case "followup_event":
        icon = <Clock className="h-3 w-3 text-pink-400" />;
        break;
      case "document_event":
        icon = <FileText className="h-3 w-3 text-blue-400" />;
        break;
      case "ticket_event":
        icon = <AlertCircle className="h-3 w-3 text-red-400" />;
        break;
    }

    const hasDetails = !!event.metadata && Object.keys(event.metadata).length > 0;

    return (
      <div key={event.id} className="relative flex gap-3 pb-4">
        {/* Connector line */}
        <div className="absolute left-[14px] top-7 bottom-0 w-0.5 bg-slate-800" />
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 border border-slate-700">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div 
            onClick={() => hasDetails && toggleExpandEvent(event.id)}
            className={cn(
              "flex items-start justify-between gap-2",
              hasDetails ? "cursor-pointer select-none hover:opacity-80" : ""
            )}
          >
            <p className="text-[13px] font-semibold text-slate-100 flex items-center gap-1">
              {title}
              {hasDetails && (
                isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              )}
            </p>
            <span className="shrink-0 text-[10px] text-slate-400">{dateStr}</span>
          </div>
          <p className="mt-1 text-xs text-slate-300 leading-relaxed">
            {description}
          </p>

          {/* Expandable Metadata Detail Pane */}
          {hasDetails && isExpanded && (
            <div className="mt-2 rounded bg-slate-950 p-2 text-[9px] text-slate-300 font-mono overflow-x-auto border border-slate-800 space-y-1">
              {event.event_type === "tool_call" ? (
                <div className="space-y-1">
                  <p className="text-purple-400 font-semibold uppercase text-[8px]">Agent: {event.metadata.agent_name}</p>
                  <div>
                    <span className="text-slate-500">Arguments:</span>
                    <pre className="text-slate-300 whitespace-pre-wrap">{JSON.stringify(event.metadata.arguments, null, 2)}</pre>
                  </div>
                  {event.metadata.error_message ? (
                    <div className="text-rose-400">
                      <span>Error:</span>
                      <pre className="whitespace-pre-wrap">{event.metadata.error_message}</pre>
                    </div>
                  ) : (
                    <div>
                      <span className="text-slate-500">Result:</span>
                      <pre className="text-slate-300 whitespace-pre-wrap">{JSON.stringify(event.metadata.result, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ) : event.event_type === "message" ? (
                <div>
                  <span className="text-slate-500">Full Message:</span>
                  <p className="text-slate-200 font-sans whitespace-pre-wrap mt-0.5">{description}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-sans">
                  {Object.entries(event.metadata).map(([key, val]) => {
                    if (val === null || val === undefined || typeof val === "object") return null;
                    return (
                      <div key={key} className="flex flex-col border-b border-slate-900 pb-1">
                        <span className="text-slate-500 text-[8px] uppercase tracking-wider">{key}</span>
                        <span className="text-slate-200 break-all">{String(val)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full w-full lg:w-80 min-w-0 flex-col border-l border-slate-800 bg-slate-900 overflow-hidden">
      {/* Mobile-only Header with Close Button */}
      {isMobile && (
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 shrink-0 lg:hidden">
          <h3 className="text-sm font-semibold text-slate-100">Contact Info</h3>
          <SheetClose render={<button className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors" aria-label="Close" />}>
            <X className="h-5 w-5" />
          </SheetClose>
        </div>
      )}

      {/* Sidebar Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-900/50 p-2 shrink-0">
        <button
          onClick={() => setActiveTab("details")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors",
            activeTab === "details"
              ? "bg-slate-800 text-slate-100"
              : "text-slate-400 hover:text-slate-100"
          )}
        >
          <Info className="h-3.5 w-3.5" />
          Details
        </button>
        <button
          onClick={() => setActiveTab("timeline")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors",
            activeTab === "timeline"
              ? "bg-slate-800 text-slate-100"
              : "text-slate-400 hover:text-slate-100"
          )}
          disabled={!conversation}
        >
          <History className="h-3.5 w-3.5" />
          Timeline
        </button>
        <button
          onClick={() => setActiveTab("tickets")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors",
            activeTab === "tickets"
              ? "bg-slate-800 text-slate-100"
              : "text-slate-400 hover:text-slate-100"
          )}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          Tickets
        </button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {activeTab === "details" ? (
          <div className="p-4 space-y-5">
            {/* Contact Profile */}
            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-700 text-lg font-semibold text-slate-100">
                {contact.avatar_url ? (
                  <img
                    src={contact.avatar_url}
                    alt={displayName}
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  initials
                )}
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-100">
                {displayName}
              </h3>
              {contact.company && (
                <p className="text-xs text-slate-400">{contact.company}</p>
              )}
            </div>

            {/* Contact Details */}
            <div className="space-y-1">
              <button
                onClick={handleCopyPhone}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-800"
              >
                <Phone className="h-3.5 w-3.5 text-slate-500" />
                <span className="flex-1 text-left">{contact.phone}</span>
                {copied ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <Copy className="h-3 w-3 text-slate-600" />
                )}
              </button>

              {contact.email && (
                <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
                  <Mail className="h-3.5 w-3.5 text-slate-500" />
                  <span className="truncate">{contact.email}</span>
                </div>
              )}
            </div>

            <div className="border-t border-slate-800" />

            {/* Tag Manager */}
            <div>
              <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <TagIcon className="h-3.5 w-3.5" />
                Tags
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                    <button
                      onClick={() => handleRemoveTag(tag.id)}
                      className="rounded-full p-0.5 hover:bg-slate-700/50"
                      title={`Remove ${tag.name}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              
              {/* Add Tag Select Dropdown */}
              {availableTags.length > 0 && (
                <div className="mt-2.5">
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        handleAddTag(e.target.value);
                        e.target.value = "";
                      }
                    }}
                    className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 outline-none focus:border-primary/50"
                  >
                    <option value="">Add tag...</option>
                    {availableTags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="border-t border-slate-800" />

            {/* Active Deals */}
            <div>
              <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <DollarSign className="h-3.5 w-3.5" />
                Active Deals
              </div>
              <div className="mt-2 space-y-2">
                {deals.length === 0 ? (
                  <p className="px-1 text-xs text-slate-600">No active deals</p>
                ) : (
                  deals.map((deal) => (
                    <div
                      key={deal.id}
                      className="rounded-lg bg-slate-800 px-3 py-2"
                    >
                      <p className="text-xs font-medium text-white">
                        {deal.title}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                        <span>
                          {deal.currency ?? "$"}
                          {deal.value.toLocaleString()}
                        </span>
                        {deal.stage && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px]"
                            style={{
                              backgroundColor: `${deal.stage.color}20`,
                              color: deal.stage.color,
                            }}
                          >
                            {deal.stage.name}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border-t border-slate-800" />

            {/* Internal Notes */}
            <div>
              <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <StickyNote className="h-3.5 w-3.5" />
                Internal Notes
              </div>
              <div className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Add a team note..."
                    rows={2}
                    className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-primary/50"
                  />
                  <Button
                    size="sm"
                    className="h-auto bg-primary px-2 hover:bg-primary/90"
                    onClick={handleAddNote}
                    disabled={!newNote.trim() || addingNote}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="space-y-2 pt-1">
                  {notes.map((note) => (
                    <div
                      key={note.id}
                      className="rounded-lg bg-slate-800 px-3 py-2.5"
                    >
                      <p className="whitespace-pre-wrap text-xs text-slate-200 leading-relaxed">
                        {note.note_text}
                      </p>
                      <p className="mt-1.5 text-[10px] text-slate-400">
                        {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === "timeline" ? (
          /* Chronological Timeline Tab */
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <History className="h-3.5 w-3.5" />
                Customer Timeline
              </div>
              <button
                onClick={fetchTimeline}
                disabled={loadingTimeline}
                className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1"
                title="Refresh timeline"
              >
                <RefreshCw className={cn("h-2.5 w-2.5", loadingTimeline && "animate-spin")} />
                Refresh
              </button>
            </div>

            {/* Timeline Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search timeline..."
                value={timelineSearch}
                onChange={(e) => setTimelineSearch(e.target.value)}
                className="w-full rounded-md border border-slate-800 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-primary/45"
              />
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
            </div>

            {/* Timeline Filter Pills */}
            <div className="flex flex-wrap gap-1.5">
              {(["all", "message", "crm", "ai", "system"] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setTimelineFilter(filter)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold border capitalize transition-colors cursor-pointer",
                    timelineFilter === filter
                      ? "bg-primary/25 border-primary text-primary shadow-sm"
                      : "border-slate-800 bg-slate-950 text-slate-300 hover:text-slate-100 hover:bg-slate-800/50"
                  )}
                >
                  {filter}
                </button>
              ))}
            </div>

            {loadingTimeline ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : filteredTimelineEvents.length === 0 ? (
              <p className="px-1 text-xs text-slate-500 py-4">No matching events found.</p>
            ) : (
              <div className="mt-2 pl-1">
                {filteredTimelineEvents.map(renderTimelineEvent)}
              </div>
            )}
          </div>
        ) : (
          /* Tickets Tab */
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <AlertCircle className="h-3.5 w-3.5" />
                Tickets
              </div>
              <button
                onClick={() => setIsCreateDialogOpen(true)}
                className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-white hover:bg-primary/95 transition-colors flex items-center gap-1"
              >
                <Plus className="h-3 w-3" />
                New Ticket
              </button>
            </div>

            {loadingTickets ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : tickets.length === 0 ? (
              <p className="px-1 text-xs text-slate-500 py-4">No support tickets found.</p>
            ) : (
              <div className="space-y-3">
                {tickets.map((t) => {
                  const isExpanded = selectedTicketId === t.id;
                  const comments = ticketComments[t.id] || [];
                  const newComment = newCommentText[t.id] || "";
                  const suggestion = aiSuggestions[t.id];
                  const isAnalyzing = loadingAiAnalysis[t.id];
                  const replySuggestion = suggestedReplies[t.id];
                  const isGeneratingReply = loadingSuggestedReply[t.id];

                  return (
                    <div
                      key={t.id}
                      className={cn(
                        "rounded-xl border border-slate-800 bg-slate-950 p-3 transition-all",
                        isExpanded && "border-slate-700 bg-slate-900/40"
                      )}
                    >
                      {/* Ticket Header (Always Visible) */}
                      <div
                        onClick={() => handleTicketExpand(t.id)}
                        className="cursor-pointer space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                              t.status === "open" && "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
                              t.status === "resolved" && "bg-blue-500/10 text-blue-400 border border-blue-500/20",
                              t.status === "closed" && "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                            )}
                          >
                            {t.status}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[9px] font-medium capitalize",
                              t.priority === "high" && "bg-rose-500/10 text-rose-400 border border-rose-500/20",
                              t.priority === "medium" && "bg-amber-500/10 text-amber-400 border border-amber-500/20",
                              t.priority === "low" && "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                            )}
                          >
                            {t.priority}
                          </span>
                        </div>
                        <h4 className="text-xs font-semibold text-white leading-relaxed">{t.title}</h4>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-sans pt-1">
                          <span className="capitalize bg-slate-800/80 px-1.5 py-0.5 rounded text-slate-400">{t.category || "general"}</span>
                          <span>{format(new Date(t.created_at), "MMM d")}</span>
                        </div>
                      </div>

                      {/* Expanded View */}
                      {isExpanded && (
                        <div className="mt-3.5 space-y-4 border-t border-slate-800/60 pt-3.5 animate-in fade-in slide-in-from-top-1 duration-200">
                          {/* Assignee selector & status selector */}
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <label className="block text-slate-500 mb-1">Assignee</label>
                              <select
                                value={t.assigned_agent_id || ""}
                                onChange={(e) => handleUpdateTicketField(t.id, { assignedAgentId: e.target.value || null })}
                                className="w-full rounded-md border border-slate-850 bg-slate-900 px-2 py-1 text-slate-300 outline-none focus:border-primary/50"
                              >
                                <option value="">Unassigned</option>
                                {profiles.map((p) => (
                                  <option key={p.user_id} value={p.user_id}>
                                    {p.full_name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-slate-500 mb-1">Status</label>
                              <select
                                value={t.status}
                                onChange={(e) => {
                                  if (e.target.value !== "resolved") {
                                    handleUpdateTicketField(t.id, { status: e.target.value });
                                  }
                                }}
                                className="w-full rounded-md border border-slate-850 bg-slate-900 px-2 py-1 text-slate-300 outline-none focus:border-primary/50"
                                disabled={t.status === "resolved"}
                              >
                                <option value="open">Open</option>
                                <option value="closed">Closed</option>
                                <option value="resolved" disabled>Resolved</option>
                              </select>
                            </div>
                          </div>

                          {/* Category & Priority selectors */}
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <label className="block text-slate-500 mb-1">Category</label>
                              <select
                                value={t.category || "general"}
                                onChange={(e) => handleUpdateTicketField(t.id, { category: e.target.value })}
                                className="w-full rounded-md border border-slate-850 bg-slate-900 px-2 py-1 text-slate-300 outline-none focus:border-primary/50"
                              >
                                <option value="general">General</option>
                                <option value="billing">Billing</option>
                                <option value="technical">Technical</option>
                                <option value="installation">Installation</option>
                                <option value="sales">Sales</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-slate-500 mb-1">Priority</label>
                              <select
                                value={t.priority}
                                onChange={(e) => handleUpdateTicketField(t.id, { priority: e.target.value })}
                                className="w-full rounded-md border border-slate-850 bg-slate-900 px-2 py-1 text-slate-300 outline-none focus:border-primary/50"
                              >
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                              </select>
                            </div>
                          </div>

                          {/* AI Suggestions Section */}
                          <div className="rounded-lg bg-purple-500/5 border border-purple-500/10 p-2.5 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-1">
                                <Zap className="h-3 w-3" />
                                AI Copilot
                              </span>
                              {!suggestion && (
                                <button
                                  onClick={() => handleAnalyzeTicketAI(t.id, t.title)}
                                  disabled={isAnalyzing}
                                  className="text-[9px] text-purple-400 hover:text-purple-300 font-medium disabled:opacity-40"
                                >
                                  {isAnalyzing ? "Analyzing..." : "Analyze Request"}
                                </button>
                              )}
                            </div>

                            {suggestion && (
                              <div className="text-[10px] space-y-1.5">
                                <div className="text-slate-300 leading-relaxed">
                                  AI Category: <span className="text-purple-400 font-medium capitalize">{suggestion.category}</span> • Priority: <span className="text-purple-400 font-medium capitalize">{suggestion.priority}</span>
                                  {suggestion.escalated && (
                                    <div className="mt-1 text-rose-400 font-medium flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3 shrink-0" />
                                      Urgency/escalation detected!
                                    </div>
                                  )}
                                </div>
                                <button
                                  onClick={() => {
                                    handleUpdateTicketField(t.id, {
                                      category: suggestion.category,
                                      priority: suggestion.priority,
                                    });
                                    setAiSuggestions(prev => {
                                      const next = { ...prev };
                                      delete next[t.id];
                                      return next;
                                    });
                                  }}
                                  className="rounded bg-purple-600 px-2 py-0.5 text-[9px] font-medium text-white hover:bg-purple-500 transition-colors"
                                >
                                  Apply AI Suggestions
                                </button>
                              </div>
                            )}

                            {/* AI Suggested Response */}
                            <div className="space-y-1.5 border-t border-purple-500/10 pt-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-purple-400 font-medium">Suggested Response</span>
                                <button
                                  onClick={() => handleSuggestReplyAI(t.id)}
                                  disabled={isGeneratingReply}
                                  className="text-[9px] text-purple-400 hover:text-purple-300 font-medium disabled:opacity-40"
                                >
                                  {isGeneratingReply ? "Generating..." : replySuggestion ? "Regenerate" : "Draft Reply"}
                                </button>
                              </div>

                              {replySuggestion && (
                                <div className="space-y-2">
                                  <textarea
                                    readOnly
                                    value={replySuggestion}
                                    className="w-full min-h-[60px] resize-none rounded-md bg-slate-900 border border-slate-800 p-2 text-[10px] text-slate-300 leading-relaxed outline-none"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleCopyToComposer(replySuggestion)}
                                      className="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-[9px] font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                                    >
                                      Insert in Composer
                                    </button>
                                    <button
                                      onClick={async () => {
                                        await navigator.clipboard.writeText(replySuggestion);
                                        toast.success("Copied to clipboard");
                                      }}
                                      className="text-[9px] text-slate-400 hover:text-slate-200 py-1"
                                    >
                                      Copy
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Resolution Tracking Section */}
                          {t.status !== "resolved" ? (
                            <div className="space-y-2 border-t border-slate-800/60 pt-3">
                              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                Resolution Notes
                              </label>
                              <div className="flex gap-2">
                                <textarea
                                  placeholder="Describe how the ticket was resolved..."
                                  value={resolutionNotes[t.id] || ""}
                                  onChange={(e) => setResolutionNotes({ ...resolutionNotes, [t.id]: e.target.value })}
                                  rows={1.5}
                                  className="flex-1 resize-none rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder-slate-600 outline-none focus:border-primary/50"
                                />
                                <Button
                                  size="sm"
                                  className="h-auto bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                                  onClick={() => handleResolveTicket(t.id)}
                                  disabled={submittingResolution[t.id] || !(resolutionNotes[t.id] || "").trim()}
                                >
                                  Resolve
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/10 p-2.5 text-[10px] space-y-1">
                              <div className="font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                                <Check className="h-3 w-3" />
                                Resolved
                              </div>
                              <p className="text-slate-300 italic leading-relaxed font-sans">
                                &ldquo;{t.resolution_notes}&rdquo;
                              </p>
                              {t.resolved_at && (
                                <p className="text-[9px] text-slate-500">
                                  Resolved on {format(new Date(t.resolved_at), "MMM d, yyyy HH:mm")}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Internal Notes / Comments Feed */}
                          <div className="space-y-2.5 border-t border-slate-800/60 pt-3.5">
                            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                              Internal Notes ({t.commentCount || 0})
                            </label>
                            
                            {/* Comment Input */}
                            <div className="flex gap-2">
                              <textarea
                                placeholder="Add team comment..."
                                value={newComment}
                                onChange={(e) => setNewCommentText({ ...newCommentText, [t.id]: e.target.value })}
                                rows={1.5}
                                className="flex-1 resize-none rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder-slate-600 outline-none focus:border-primary/50"
                              />
                              <Button
                                size="sm"
                                className="h-auto bg-slate-800 border border-slate-700 px-2.5 hover:bg-slate-700 disabled:opacity-40"
                                onClick={() => handleAddComment(t.id)}
                                disabled={submittingComment[t.id] || !newComment.trim()}
                              >
                                <Plus className="h-3.5 w-3.5 text-white" />
                              </Button>
                            </div>

                            {/* Comment List */}
                            <div className="space-y-1.5 max-h-[150px] overflow-y-auto pr-1">
                              {comments.length === 0 ? (
                                <p className="text-[10px] text-slate-600 px-1 py-1">No notes added.</p>
                              ) : (
                                comments.map((c) => (
                                  <div
                                    key={c.id}
                                    className="rounded-lg bg-slate-900 p-2 border border-slate-800"
                                  >
                                    <p className="whitespace-pre-wrap text-[10px] text-slate-300 leading-normal font-sans">
                                      {c.content}
                                    </p>
                                    <div className="mt-1 flex items-center justify-between text-[8px] text-slate-500">
                                      <span>{c.author?.full_name || "Team Member"}</span>
                                      <span>{format(new Date(c.created_at), "MMM d, HH:mm")}</span>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Create Ticket Modal Overlay */}
      {isCreateDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h4 className="text-sm font-semibold text-white">Create Support Ticket</h4>
              <button onClick={() => setIsCreateDialogOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Ticket Title *</label>
                <input
                  type="text"
                  placeholder="e.g. Electrical permit delay"
                  value={createForm.title}
                  onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-white outline-none focus:border-primary/50 placeholder-slate-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Category</label>
                  <select
                    value={createForm.category}
                    onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-slate-300 outline-none focus:border-primary/50"
                  >
                    <option value="general">General</option>
                    <option value="billing">Billing</option>
                    <option value="technical">Technical</option>
                    <option value="installation">Installation</option>
                    <option value="sales">Sales</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Priority</label>
                  <select
                    value={createForm.priority}
                    onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value })}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-slate-300 outline-none focus:border-primary/50"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Assign Agent</label>
                <select
                  value={createForm.assignedAgentId}
                  onChange={(e) => setCreateForm({ ...createForm, assignedAgentId: e.target.value })}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-slate-300 outline-none focus:border-primary/50"
                >
                  <option value="">Unassigned</option>
                  {profiles.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Initial Note</label>
                <textarea
                  placeholder="Add internal notes about this issue..."
                  value={createForm.initialNote}
                  onChange={(e) => setCreateForm({ ...createForm, initialNote: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-white outline-none focus:border-primary/50 placeholder-slate-600"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  onClick={() => setIsCreateDialogOpen(false)}
                  className="rounded-lg border border-slate-800 px-4 py-2 font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateTicket}
                  disabled={!createForm.title.trim()}
                  className="rounded-lg bg-primary px-4 py-2 font-medium text-white hover:bg-primary/95 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
