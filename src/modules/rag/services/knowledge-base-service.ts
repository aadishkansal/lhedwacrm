import { supabaseAdmin } from '../../workflows/services/admin-client';
import { embeddingPipeline } from './embedding-pipeline';
import { EmbeddingService } from './embedding-service';

export interface UploadDocumentParams {
  kbId: string;
  organizationId: string;
  buffer: Buffer;
  fileName: string; // original file name e.g. "manual.pdf"
  title: string;    // user friendly title
  fileType: 'pdf' | 'docx' | 'txt' | 'faq' | 'markdown';
  category: 'Company Information' | 'Solar Products' | 'Warranty Documents' | 'Subsidy Documents' | 'Installation Guides' | 'Policies' | 'Sales Scripts';
  userId?: string;  // Track who uploaded the document
}

export interface SearchFilters {
  category?: string;
  fileType?: string;
  threshold?: number;
  limit?: number;
}

export class KnowledgeBaseService {
  private embeddingService = new EmbeddingService();

  /**
   * Uploads and registers a new document or updates an existing one (incrementing version).
   * Spawns background chunk processing and embedding.
   */
  async uploadDocument(params: UploadDocumentParams) {
    const db = supabaseAdmin();

    // 1. Check if document with same title exists in this knowledge base
    const { data: existing, error: checkError } = await db
      .from('kb_documents')
      .select('*')
      .eq('kb_id', params.kbId)
      .eq('title', params.title.trim())
      .maybeSingle();

    if (checkError) {
      throw new Error(`Failed to check existing document: ${checkError.message}`);
    }

    let document: any;

    if (existing) {
      // Versioning: increment version and overwrite
      const nextVersion = existing.version + 1;
      
      const { data: updated, error: updateError } = await db
        .from('kb_documents')
        .update({
          file_path: params.fileName,
          file_size: params.buffer.length,
          file_type: params.fileType,
          category: params.category,
          version: nextVersion,
          status: 'processing',
          error_message: null,
          created_by: params.userId || existing.created_by,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single();

      if (updateError) {
        throw new Error(`Failed to update existing document version: ${updateError.message}`);
      }
      document = updated;
    } else {
      // Create new document row
      const { data: inserted, error: insertError } = await db
        .from('kb_documents')
        .insert({
          kb_id: params.kbId,
          organization_id: params.organizationId,
          title: params.title.trim(),
          file_path: params.fileName,
          file_size: params.buffer.length,
          file_type: params.fileType,
          category: params.category,
          version: 1,
          status: 'processing',
          error_message: null,
        })
        .select('*')
        .single();

      if (insertError) {
        throw new Error(`Failed to register document: ${insertError.message}`);
      }
      document = inserted;
    }

    // 2. Trigger asynchronous embedding processing
    void embeddingPipeline
      .processDocument({
        documentId: document.id,
        kbId: params.kbId,
        organizationId: params.organizationId,
        buffer: params.buffer,
        fileType: params.fileType,
        title: params.title,
        category: params.category,
      })
      .catch((err) => {
        console.error(`[KnowledgeBaseService] Background processing failed for ${document.id}:`, err.message);
      });

    return document;
  }

  /**
   * Deletes a document and automatically cascade deletes all associated chunks.
   */
  async deleteDocument(documentId: string, organizationId: string): Promise<void> {
    const db = supabaseAdmin();
    const { error } = await db
      .from('kb_documents')
      .delete()
      .eq('id', documentId)
      .eq('organization_id', organizationId);

    if (error) {
      throw new Error(`Failed to delete document: ${error.message}`);
    }
  }

  /**
   * Lists all documents registered in a knowledge base.
   */
  async getDocuments(kbId: string, organizationId: string) {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('kb_documents')
      .select('*')
      .eq('kb_id', kbId)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch documents: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Retrieves a single document config and status by ID.
   */
  async getDocument(documentId: string, organizationId: string) {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('kb_documents')
      .select('*')
      .eq('id', documentId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch document: ${error.message}`);
    }

    return data;
  }

  /**
   * Performs a category and format-filtered semantic search across chunks.
   */
  async search(kbId: string, query: string, filters: SearchFilters = {}) {
    const embedding = await this.embeddingService.getEmbedding(query);
    const db = supabaseAdmin();

    const { data, error } = await db.rpc('match_document_chunks_filtered', {
      p_kb_id: kbId,
      query_embedding: embedding,
      match_threshold: filters.threshold ?? 0.4,
      match_count: filters.limit ?? 5,
      p_category: filters.category || null,
      p_file_type: filters.fileType || null,
    });

    if (error) {
      throw new Error(`Failed to search document chunks: ${error.message}`);
    }

    return data || [];
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
