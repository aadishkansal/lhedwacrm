'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Search,
  Trash2,
  Upload,
  ExternalLink,
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Plus,
  Sliders,
  Database,
  RefreshCw,
  FileCode,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Categories allowed by the backend
const CATEGORIES = [
  'Company Information',
  'Solar Products',
  'Warranty Documents',
  'Subsidy Documents',
  'Installation Guides',
  'Policies',
  'Sales Scripts',
];

const FILE_TYPES = [
  { value: 'pdf', label: 'PDF Document' },
  { value: 'docx', label: 'Word Document' },
  { value: 'txt', label: 'Plain Text' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'faq', label: 'FAQ (JSON)' },
];

interface Document {
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

interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata: {
    title?: string;
    category?: string;
    file_type?: string;
    [key: string]: any;
  };
}

export default function KnowledgePage() {
  const [kbId, setKbId] = useState<string | null>(null);
  const [kbName, setKbName] = useState<string>('');
  const [kbDescription, setKbDescription] = useState<string>('');
  
  // Loading & State
  const [loadingKb, setLoadingKb] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [refreshingDocs, setRefreshingDocs] = useState(false);
  
  // Dialog States
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState(CATEGORIES[0]);
  const [uploadFileType, setUploadFileType] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Deletion States
  const [deletingDoc, setDeletingDoc] = useState<Document | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  // Semantic Search Workbench States
  const [semanticQuery, setSemanticQuery] = useState('');
  const [semanticCategory, setSemanticCategory] = useState('All');
  const [semanticFileType, setSemanticFileType] = useState('All');
  const [semanticThreshold, setSemanticThreshold] = useState(0.4);
  const [semanticLimit, setSemanticLimit] = useState(5);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchRan, setSearchRan] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // 1. Fetch or create a default knowledge base
  const initKnowledgeBase = useCallback(async () => {
    setLoadingKb(true);
    try {
      const res = await fetch('/api/kb');
      if (!res.ok) throw new Error('Failed to fetch knowledge base');
      const data = await res.json();
      
      if (data.knowledgeBases && data.knowledgeBases.length > 0) {
        const firstKb = data.knowledgeBases[0];
        setKbId(firstKb.id);
        setKbName(firstKb.name);
        setKbDescription(firstKb.description || '');
      } else {
        // Bootstrap a default KB if none exists
        const createRes = await fetch('/api/kb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Default Knowledge Base',
            description: 'Workspace-wide shared documents and solar training materials.',
          }),
        });
        if (!createRes.ok) throw new Error('Failed to create default knowledge base');
        const createData = await createRes.json();
        setKbId(createData.knowledgeBase.id);
        setKbName(createData.knowledgeBase.name);
        setKbDescription(createData.knowledgeBase.description || '');
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingKb(false);
    }
  }, []);

  // 2. Fetch documents list
  const fetchDocuments = useCallback(async (isSilent = false) => {
    if (!kbId) return;
    if (!isSilent) setLoadingDocs(true);
    else setRefreshingDocs(true);
    
    try {
      const res = await fetch(`/api/kb/${kbId}/documents`);
      if (!res.ok) throw new Error('Failed to load documents');
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDocs(false);
      setRefreshingDocs(false);
    }
  }, [kbId]);

  useEffect(() => {
    initKnowledgeBase();
  }, [initKnowledgeBase]);

  useEffect(() => {
    if (kbId) {
      fetchDocuments();
    }
  }, [kbId, fetchDocuments]);

  // Client-side filtering of documents list
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      const matchesSearch =
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.file_path.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = categoryFilter === 'All' || doc.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [documents, searchQuery, categoryFilter]);

  // Handle document upload
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kbId || !uploadFile || !uploadTitle.trim()) return;

    setUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('title', uploadTitle.trim());
      formData.append('category', uploadCategory);
      if (uploadFileType) {
        formData.append('fileType', uploadFileType);
      }

      const res = await fetch(`/api/kb/${kbId}/documents`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to upload document');
      }

      // Reset form and close
      setUploadTitle('');
      setUploadFile(null);
      setUploadFileType('');
      setUploadCategory(CATEGORIES[0]);
      setIsUploadOpen(false);
      
      // Reload documents list
      fetchDocuments();
    } catch (err: any) {
      setUploadError(err.message || 'An error occurred during upload.');
    } finally {
      setUploading(false);
    }
  };

  // Handle document deletion
  const handleDeleteConfirm = async () => {
    if (!deletingDoc) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/kb/documents/${deletingDoc.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete document');
      
      setDeletingDoc(null);
      fetchDocuments();
    } catch (err: any) {
      alert(err.message || 'Failed to delete document');
    } finally {
      setIsDeleting(false);
    }
  };

  // Trigger Semantic Search
  const handleSemanticSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kbId || !semanticQuery.trim()) return;

    setSearching(true);
    setSearchError(null);
    setSearchRan(true);

    try {
      const res = await fetch(`/api/kb/${kbId}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: semanticQuery.trim(),
          category: semanticCategory === 'All' ? undefined : semanticCategory,
          fileType: semanticFileType === 'All' ? undefined : semanticFileType,
          threshold: semanticThreshold,
          limit: semanticLimit,
        }),
      });

      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err: any) {
      setSearchError(err.message || 'Search execution failed');
    } finally {
      setSearching(false);
    }
  };

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
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loadingKb) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-slate-400">Loading Knowledge Base configuration...</p>
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
            <BookOpen className="h-6 w-6 text-primary" />
            Knowledge Base
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage organization files, check embedding ingestion, and test RAG semantic search.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchDocuments(true)}
            className="border-slate-800 bg-slate-900/50 text-slate-400 hover:text-white"
            disabled={loadingDocs || refreshingDocs}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshingDocs ? 'animate-spin' : ''}`} />
            Refresh Status
          </Button>
          <Button
            onClick={() => setIsUploadOpen(true)}
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/95"
          >
            <Plus className="h-4 w-4 mr-2" />
            Upload Document
          </Button>
        </div>
      </div>

      {/* Main Tabs Container */}
      <Tabs defaultValue="documents" className="w-full">
        <div className="w-full overflow-x-auto scrollbar-none pb-1">
          <TabsList className="flex h-fit w-max bg-slate-900 border border-slate-800 p-0.5 mb-6">
            <TabsTrigger value="documents" className="px-5 py-1.5 text-xs sm:text-sm">
              <Database className="h-4 w-4 mr-2" />
              All Documents ({documents.length})
            </TabsTrigger>
            <TabsTrigger value="search" className="px-5 py-1.5 text-xs sm:text-sm">
              <Search className="h-4 w-4 mr-2" />
              Semantic Search Workbench
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: Documents Management list */}
        <TabsContent value="documents" className="space-y-4">
          <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md">
            <CardHeader className="pb-3 border-b border-slate-800/50">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-white text-base">Workspace Documents</CardTitle>
                  <CardDescription className="text-xs text-slate-500">
                    Ingested manuals, policies, and solar product scripts used by RAG.
                  </CardDescription>
                </div>
                
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-full sm:w-60">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                    <Input
                      placeholder="Filter by title..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-9 border-slate-800 bg-slate-950 text-white text-xs sm:text-sm placeholder:text-slate-500"
                    />
                  </div>
                  
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs sm:text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="All">All Categories</option>
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingDocs ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                  <span className="text-sm text-slate-400">Loading documents...</span>
                </div>
              ) : filteredDocuments.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center p-6">
                  <FileText className="h-10 w-10 text-slate-600 mb-2" />
                  <p className="text-sm text-slate-400 font-medium">No documents found</p>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    {documents.length === 0
                      ? "Start by uploading solar quotes, manuals, or training scripts."
                      : "No documents match the current filters."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-medium bg-slate-950/40">
                        <th className="p-4">Document Title</th>
                        <th className="p-4 hidden md:table-cell">Category</th>
                        <th className="p-4">Format</th>
                        <th className="p-4 hidden sm:table-cell">File Size</th>
                        <th className="p-4 hidden lg:table-cell">Uploaded</th>
                        <th className="p-4">Ingestion Status</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {filteredDocuments.map((doc) => (
                        <tr key={doc.id} className="hover:bg-slate-800/20 text-slate-300">
                          <td className="p-4">
                            <div className="font-semibold text-white max-w-[200px] sm:max-w-xs truncate">
                              {doc.title}
                            </div>
                            <div className="text-[10px] text-slate-500 max-w-[200px] sm:max-w-xs truncate">
                              {doc.file_path}
                            </div>
                          </td>
                          <td className="p-4 hidden md:table-cell">
                            <span className="text-slate-400">{doc.category}</span>
                          </td>
                          <td className="p-4">
                            <Badge variant="outline" className="border-slate-800 bg-slate-950 text-slate-400 uppercase text-[9px] px-1.5 py-0">
                              {doc.file_type}
                            </Badge>
                          </td>
                          <td className="p-4 hidden sm:table-cell text-slate-400">
                            {formatBytes(doc.file_size)}
                          </td>
                          <td className="p-4 hidden lg:table-cell text-slate-400">
                            {formatDate(doc.created_at)}
                          </td>
                          <td className="p-4">
                            {doc.status === 'completed' && (
                              <Badge className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-1 w-fit text-[10px]">
                                <CheckCircle2 className="h-3 w-3" /> Completed
                              </Badge>
                            )}
                            {doc.status === 'processing' && (
                              <Badge className="bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center gap-1 w-fit text-[10px]">
                                <Loader2 className="h-3 w-3 animate-spin" /> Processing
                              </Badge>
                            )}
                            {doc.status === 'failed' && (
                              <div className="group relative flex items-center gap-1 text-rose-400 cursor-help">
                                <Badge className="bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center gap-1 w-fit text-[10px]">
                                  <XCircle className="h-3 w-3" /> Failed
                                </Badge>
                                {doc.error_message && (
                                  <span className="absolute bottom-full left-0 z-50 mb-1 w-48 scale-0 rounded bg-slate-950 p-2 text-[10px] text-slate-300 shadow-xl border border-slate-800 transition-all group-hover:scale-100 whitespace-normal">
                                    {doc.error_message}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex justify-end gap-1.5">
                              <Link href={`/knowledge/${doc.id}`}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-800"
                                  title="View Chunks Details"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              </Link>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeletingDoc(doc)}
                                className="h-8 w-8 text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                                title="Delete Document"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Semantic Search Workbench */}
        <TabsContent value="search" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            
            {/* Search Filters Column */}
            <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md lg:col-span-1">
              <CardHeader className="pb-3 border-b border-slate-800/50">
                <CardTitle className="text-white text-sm flex items-center gap-1.5">
                  <Sliders className="h-4 w-4 text-primary" />
                  Workbench Controls
                </CardTitle>
                <CardDescription className="text-slate-500 text-xs">
                  Fine-tune similarity search parameters.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {/* Category filter */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Filter Category</label>
                  <select
                    value={semanticCategory}
                    onChange={(e) => setSemanticCategory(e.target.value)}
                    className="w-full h-9 rounded-md border border-slate-800 bg-slate-950 px-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="All">All Categories</option>
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                {/* File format filter */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Filter File Type</label>
                  <select
                    value={semanticFileType}
                    onChange={(e) => setSemanticFileType(e.target.value)}
                    className="w-full h-9 rounded-md border border-slate-800 bg-slate-950 px-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="All">All Formats</option>
                    {FILE_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Similarity threshold */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <label className="font-medium text-slate-400">Min Cosine Match</label>
                    <span className="font-mono text-primary">{(semanticThreshold * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="0.9"
                    step="0.05"
                    value={semanticThreshold}
                    onChange={(e) => setSemanticThreshold(parseFloat(e.target.value))}
                    className="w-full accent-primary bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                {/* Limit matches */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <label className="font-medium text-slate-400">Max Chunk Limit</label>
                    <span className="font-mono text-primary">{semanticLimit} chunks</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={semanticLimit}
                    onChange={(e) => setSemanticLimit(parseInt(e.target.value))}
                    className="w-full accent-primary bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Query & Results Column */}
            <div className="lg:col-span-3 space-y-4">
              <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md">
                <CardContent className="p-4">
                  <form onSubmit={handleSemanticSearch} className="flex gap-2">
                    <Input
                      placeholder="Ask RAG a question (e.g. 'What is the standard warranty on solar panels?')"
                      value={semanticQuery}
                      onChange={(e) => setSemanticQuery(e.target.value)}
                      className="flex-1 border-slate-800 bg-slate-950 text-white placeholder:text-slate-500"
                    />
                    <Button
                      type="submit"
                      disabled={searching || !semanticQuery.trim()}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
                    >
                      {searching ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Search className="h-4 w-4 mr-2" />
                          Query
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Search Results Display */}
              <div className="space-y-3">
                {searchError && (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <p className="text-sm">{searchError}</p>
                  </div>
                )}

                {searching && (
                  <div className="flex flex-col items-center justify-center p-12 text-slate-400">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                    <p className="text-sm">Calculating text embeddings & vector cosine matches...</p>
                  </div>
                )}

                {!searching && searchRan && searchResults.length === 0 && (
                  <Card className="border-slate-800 bg-slate-900/30 backdrop-blur-md p-8 text-center text-slate-400">
                    <Database className="h-10 w-10 mx-auto text-slate-600 mb-2" />
                    <p className="text-sm font-semibold">No relevant matches found</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                      No chunks exceeded the {(semanticThreshold * 100).toFixed(0)}% similarity threshold. Try reducing the Cosine Match threshold on the sidebar controls.
                    </p>
                  </Card>
                )}

                {!searching && searchResults.map((result, idx) => {
                  const score = (result.similarity * 100).toFixed(0);
                  const isHighMatch = result.similarity >= 0.7;
                  const isMediumMatch = result.similarity >= 0.5 && result.similarity < 0.7;
                  
                  return (
                    <Card
                      key={result.id || idx}
                      className="border-slate-800 bg-slate-900/20 hover:bg-slate-900/40 transition-colors"
                    >
                      <CardHeader className="p-4 pb-2 border-b border-slate-800/30 flex-row items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 font-mono">#{idx + 1}</span>
                          <span className="text-xs font-semibold text-white truncate max-w-[200px] sm:max-w-xs">
                            {result.metadata?.title || 'Unknown Source'}
                          </span>
                          <Badge variant="outline" className="border-slate-800 bg-slate-950 text-slate-400 text-[10px]">
                            {result.metadata?.category}
                          </Badge>
                        </div>
                        <Badge
                          className={
                            isHighMatch
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : isMediumMatch
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }
                        >
                          {score}% Match
                        </Badge>
                      </CardHeader>
                      <CardContent className="p-4">
                        <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-sans">
                          {result.content}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Upload Modal (Radix Dialog) */}
      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogContent className="border-slate-800 bg-slate-900 text-white max-w-md w-full">
          <DialogHeader>
            <DialogTitle className="text-white text-base flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Upload RAG Document
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Select PDF, DOCX, TXT, MD, or JSON to slice & generate text embeddings.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUploadSubmit} className="space-y-4 pt-2">
            {/* Title field */}
            <div className="space-y-1.5">
              <label htmlFor="title-input" className="text-xs font-medium text-slate-400">Document Title</label>
              <Input
                id="title-input"
                required
                placeholder="e.g. Warranty Policy 2026"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                className="border-slate-800 bg-slate-950 text-white placeholder:text-slate-600 text-xs sm:text-sm"
              />
            </div>

            {/* Category selection */}
            <div className="space-y-1.5">
              <label htmlFor="category-select" className="text-xs font-medium text-slate-400">Category</label>
              <select
                id="category-select"
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-800 bg-slate-950 px-2 text-xs sm:text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* File format override optional selection */}
            <div className="space-y-1.5">
              <label htmlFor="format-select" className="text-xs font-medium text-slate-400 flex items-center gap-1">
                Format Override
                <span className="text-[10px] text-slate-500 font-normal">(Optional, inferred by extension by default)</span>
              </label>
              <select
                id="format-select"
                value={uploadFileType}
                onChange={(e) => setUploadFileType(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-800 bg-slate-950 px-2 text-xs sm:text-sm text-slate-300 outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Auto-Detect Format</option>
                {FILE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* File Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Select File</label>
              <div className="relative border border-dashed border-slate-800 bg-slate-950/50 hover:bg-slate-950/70 hover:border-slate-700 transition-colors rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer">
                <input
                  type="file"
                  required
                  accept=".pdf,.docx,.txt,.md,.markdown,.json"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <FileCode className="h-8 w-8 text-slate-500 mb-2" />
                <span className="text-xs font-medium text-slate-300">
                  {uploadFile ? uploadFile.name : 'Click or Drag & Drop File'}
                </span>
                <span className="text-[10px] text-slate-500 mt-1">
                  Supports PDF, DOCX, TXT, MD, JSON (Max 50MB)
                </span>
              </div>
            </div>

            {uploadError && (
              <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-rose-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p className="text-[11px] leading-tight">{uploadError}</p>
              </div>
            )}

            <DialogFooter className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsUploadOpen(false)}
                className="border-slate-800 text-slate-300 hover:bg-slate-850 hover:text-white"
                disabled={uploading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={uploading || !uploadFile || !uploadTitle.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal (Radix Dialog) */}
      <Dialog open={!!deletingDoc} onOpenChange={(open) => !open && setDeletingDoc(null)}>
        <DialogContent className="border-slate-800 bg-slate-900 text-white max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="text-rose-400 text-base flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Delete Document?
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              This action is permanent. It will cascade-delete the document configurations, versions, and all generated embedding chunks from vector database.
            </DialogDescription>
          </DialogHeader>

          {deletingDoc && (
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs">
              <div className="font-semibold text-white">{deletingDoc.title}</div>
              <div className="text-slate-500 mt-0.5 truncate">{deletingDoc.file_path}</div>
            </div>
          )}

          <DialogFooter className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletingDoc(null)}
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
                  Deleting...
                </>
              ) : (
                'Delete Permanently'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
