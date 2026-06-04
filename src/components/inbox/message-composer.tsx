"use client";

import { useState, useRef, useCallback, KeyboardEvent, useEffect } from "react";
import { Send, LayoutTemplate, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReplyQuote } from "./reply-quote";
import { toast } from "sonner";

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}

export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onOpenTemplates,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  // Listen for text injection events from other components (like suggested replies)
  useEffect(() => {
    const handleSetText = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && typeof customEvent.detail === "string") {
        setText(customEvent.detail);
        setTimeout(adjustHeight, 0);
      }
    };
    window.addEventListener("message-composer:set-text", handleSetText);
    return () => {
      window.removeEventListener("message-composer:set-text", handleSetText);
    };
  }, [adjustHeight]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sessionExpired) return;

    setSending(true);
    try {
      onSend(trimmed, replyTo?.id);
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, sessionExpired, onSend, replyTo?.id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  const handleAISuggest = useCallback(async () => {
    if (loadingSuggestion || sessionExpired) return;
    setLoadingSuggestion(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/suggest-reply`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch suggestions");
      }
      const data = await res.json();
      if (data.suggestion) {
        setText(data.suggestion);
        // Set height on next tick
        setTimeout(adjustHeight, 0);
        toast.success("AI draft suggested!");
      } else {
        toast.error("No suggestion returned from AI");
      }
    } catch (err: unknown) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      toast.error(errMsg || "Failed to fetch reply suggestions");
    } finally {
      setLoadingSuggestion(false);
    }
  }, [conversationId, loadingSuggestion, sessionExpired, adjustHeight]);

  return (
    <div className="border-t border-slate-800 bg-slate-900 p-3">
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}
      {sessionExpired && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            24-hour session expired. Use a template to re-engage.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            Templates
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-slate-400 hover:text-white"
            onClick={onOpenTemplates}
            title="Send template"
          >
            <LayoutTemplate className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-9 w-9 p-0 text-slate-400 hover:text-primary-foreground hover:bg-slate-800",
              loadingSuggestion && "text-primary animate-pulse"
            )}
            onClick={handleAISuggest}
            disabled={sessionExpired || loadingSuggestion}
            title="AI Suggest reply"
          >
            {loadingSuggestion ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Sparkles className="h-4 w-4 text-purple-400" />
            )}
          </Button>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            sessionExpired
              ? "Session expired - use a template"
              : "Type a message... (Shift+Enter for new line)"
          }
          disabled={sessionExpired}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-primary/50",
            sessionExpired && "cursor-not-allowed opacity-50"
          )}
        />

        <Button
          size="sm"
          className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
          disabled={!text.trim() || sessionExpired || sending}
          onClick={handleSend}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Hint sits outside the flex row so its height doesn't push
          `items-end` buttons below the textarea. Indented to line up
          under the textarea left edge (two w-9 buttons + gap-1 + gap-2 = ~84px). */}
      <p className="mt-1 pl-2 sm:pl-[88px] text-[10px] text-slate-600 text-center sm:text-left">
        Type &apos;/&apos; for quick replies • Click AI Sparkles for RAG suggestions
      </p>
    </div>
  );
}
