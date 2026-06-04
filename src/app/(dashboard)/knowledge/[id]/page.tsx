'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  Layers,
  FileText,
  FileCode,
  CheckCircle2,
  XCircle,
  Loader2,
  HardDrive,
  Tag,
  Hash,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface DocumentDetails {
  id: string;
  kb_id: string;
  title: string;
  file_path: string;
  file_size: number;
  file_type: string;
  category: string;
  version: number;
  status: 'processing' | 'completed' | 'failed';
  error_message: string | null;
  created_at: string;
}

interface Chunk {
  id: string;
  content: string;
  metadata: {
    page_number?: number;
    loc?: {
      lines?: {
        from: number;
        to: number;
      };
    };
    [key: string]: any;
  } | null;
  created_at: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function DocumentDetailsPage({ params }: PageProps) {
  const { id: docId } = use(params);
  
  const [document, setDocument] = useState<DocumentDetails | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDetails = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/kb/documents/${docId}/chunks`);
        if (!res.ok) {
          if (res.status === 404) throw new Error('Document not found');
          throw new Error('Failed to load document details');
        }
        const data = await res.json();
        setDocument(data.document);
        setChunks(data.chunks || []);
      } catch (err: any) {
        setError(err.message || 'An unexpected error occurred.');
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [docId]);

  // Format Helper
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-slate-400">Loading document metadata & chunks...</p>
        </div>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="space-y-4 max-w-lg mx-auto mt-12">
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-6 text-rose-400">
          <AlertCircle className="h-6 w-6 shrink-0" />
          <div>
            <h2 className="font-semibold text-white">Error Loading Document</h2>
            <p className="text-sm mt-1">{error || 'Document metadata could not be fetched.'}</p>
          </div>
        </div>
        <Link href="/knowledge">
          <Button variant="outline" className="w-full border-slate-800 bg-slate-900 text-slate-300">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back navigation & Quick Actions */}
      <div className="flex items-center justify-between">
        <Link href="/knowledge">
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent hover:border-slate-850"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>
      </div>

      {/* Hero Header Card */}
      <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-primary/10 border border-primary/20 text-primary uppercase text-[10px] tracking-wider px-2">
                  {document.file_type}
                </Badge>
                <Badge variant="outline" className="border-slate-800 bg-slate-950 text-slate-400 text-[10px]">
                  {document.category}
                </Badge>
                {document.status === 'completed' && (
                  <Badge className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Ingestion Completed
                  </Badge>
                )}
                {document.status === 'processing' && (
                  <Badge className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Embedding Extraction
                  </Badge>
                )}
                {document.status === 'failed' && (
                  <Badge className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] flex items-center gap-1">
                    <XCircle className="h-3 w-3" /> Ingestion Failed
                  </Badge>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">
                {document.title}
              </h1>
              <p className="text-xs text-slate-500 font-mono truncate max-w-xl">
                File Path: {document.file_path}
              </p>
            </div>

            {/* Document stats */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-slate-400 bg-slate-950/40 p-4 rounded-xl border border-slate-800/40 min-w-[200px]">
              <div className="flex items-center gap-1.5 text-slate-500">
                <HardDrive className="h-3.5 w-3.5" />
                <span>File Size</span>
              </div>
              <span className="font-semibold text-white text-right">{formatBytes(document.file_size)}</span>

              <div className="flex items-center gap-1.5 text-slate-500">
                <Layers className="h-3.5 w-3.5" />
                <span>Version</span>
              </div>
              <span className="font-semibold text-white text-right">v{document.version}</span>

              <div className="flex items-center gap-1.5 text-slate-500">
                <Calendar className="h-3.5 w-3.5" />
                <span>Uploaded</span>
              </div>
              <span className="font-semibold text-white text-right">{new Date(document.created_at).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Ingestion Error Alert */}
          {document.status === 'failed' && document.error_message && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-rose-400 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-white">Ingestion Failure Details</p>
                <p className="mt-1 leading-relaxed text-rose-300">{document.error_message}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Columns Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Document Ingestion Summary Cards */}
        <div className="space-y-4 lg:col-span-1">
          <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md">
            <CardHeader className="pb-3 border-b border-slate-800/50">
              <CardTitle className="text-white text-sm flex items-center gap-1.5">
                <Hash className="h-4 w-4 text-primary" />
                Embedding Details
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Vector space partitioning metrics.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-850">
                <span className="text-slate-400">Total Chunks Sliced</span>
                <span className="font-semibold text-white font-mono">{chunks.length}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-850">
                <span className="text-slate-400">Embedding Dimension</span>
                <span className="font-semibold text-white font-mono">1536 (OpenAI small)</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-850">
                <span className="text-slate-400">Similarity Standard</span>
                <span className="font-semibold text-white">Cosine Distance</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400">RLS Control</span>
                <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] px-1.5 py-0">
                  Active Org Only
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md">
            <CardHeader className="pb-3 border-b border-slate-800/50">
              <CardTitle className="text-white text-sm flex items-center gap-1.5">
                <Tag className="h-4 w-4 text-primary" />
                RAG Metadata Tags
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              <div className="space-y-1">
                <div className="text-[10px] text-slate-500 uppercase font-medium">KB Reference</div>
                <div className="text-xs text-slate-300 font-mono select-all truncate bg-slate-950 p-1.5 rounded border border-slate-850">
                  {document.kb_id}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-slate-500 uppercase font-medium">Document ID</div>
                <div className="text-xs text-slate-300 font-mono select-all truncate bg-slate-950 p-1.5 rounded border border-slate-850">
                  {document.id}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Chunks Exploration Column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-1.5">
              <FileCode className="h-4 w-4 text-primary" />
              Slices and Chunks List ({chunks.length})
            </h2>
          </div>

          {chunks.length === 0 ? (
            <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md p-8 text-center text-slate-400">
              <FileText className="h-10 w-10 mx-auto text-slate-600 mb-2" />
              <p className="text-sm font-semibold">No text chunks loaded</p>
              <p className="text-xs text-slate-500 mt-1">
                {document.status === 'processing'
                  ? 'Embeddings are still being computed in the background. Please wait.'
                  : 'Ingestion might have failed or the file contains no parseable text.'}
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {chunks.map((chunk, index) => {
                const words = chunk.content.trim().split(/\s+/).length;
                const chars = chunk.content.length;
                
                return (
                  <Card key={chunk.id} className="border-slate-800 bg-slate-900/20">
                    <CardHeader className="p-4 pb-2 border-b border-slate-800/30 flex-row items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 font-semibold font-mono">Chunk #{index + 1}</span>
                        {chunk.metadata?.page_number !== undefined && (
                          <Badge variant="outline" className="border-slate-800 bg-slate-950 text-slate-400 text-[10px]">
                            Page {chunk.metadata.page_number}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono flex items-center gap-3">
                        <span>{chars} Chars</span>
                        <span>{words} Words</span>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4">
                      <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-sans">
                        {chunk.content}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
