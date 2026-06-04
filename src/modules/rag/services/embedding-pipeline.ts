import { supabaseAdmin } from '../../workflows/services/admin-client';
import { ChunkingService } from './chunking-service';
import { EmbeddingWorker } from './embedding-worker';
import { MetadataManager } from './metadata-manager';
import { documentProcessor } from './document-processor';

export class EmbeddingPipeline {
  private chunkingService = new ChunkingService();
  private embeddingWorker = new EmbeddingWorker();
  private metadataManager = new MetadataManager();

  /**
   * Processes a document by extracting its text/FAQs, chunking, generating embeddings,
   * cleaning up old chunks (for updates), inserting new chunks, and updating the status.
   */
  async processDocument(params: {
    documentId: string;
    kbId: string;
    organizationId: string;
    buffer: Buffer;
    fileType: 'pdf' | 'docx' | 'txt' | 'faq' | 'markdown';
    title: string;
    category: string;
  }): Promise<void> {
    const db = supabaseAdmin();

    try {
      // 1. Extract content and chunk it
      let chunks: string[] = [];
      if (params.fileType === 'faq') {
        const faqs = documentProcessor.parseFAQ(params.buffer);
        chunks = this.chunkingService.chunkFAQs(faqs);
      } else {
        const text = await documentProcessor.extractText(params.buffer, params.fileType);
        if (!text.trim()) {
          throw new Error('Document extraction returned empty text.');
        }
        chunks = this.chunkingService.chunkText(text);
      }

      if (chunks.length === 0) {
        throw new Error('No chunks generated from document content.');
      }

      // 2. Batch generate embeddings using embedding worker (concurrency limited)
      const embeddings = await this.embeddingWorker.generateEmbeddingsInBatches(chunks);

      // 3. Delete any existing chunks linked to this document ID (for version updates)
      const { error: deleteError } = await db
        .from('document_chunks')
        .delete()
        .eq('document_id', params.documentId);

      if (deleteError) {
        throw new Error(`Failed to clear old chunks: ${deleteError.message}`);
      }

      // 4. Build and insert new chunks
      const rows = chunks.map((chunk, index) => {
        const metadata = this.metadataManager.buildMetadata({
          title: params.title,
          type: params.fileType === 'faq' ? 'solar_faq' : 'warranty',
          chunkIndex: index,
          totalChunks: chunks.length,
          source: params.fileType,
          extra: {
            category: params.category,
            document_id: params.documentId,
          }
        });

        return {
          kb_id: params.kbId,
          document_id: params.documentId,
          content: chunk,
          embedding: embeddings[index],
          metadata
        };
      });

      const { error: insertError } = await db.from('document_chunks').insert(rows);
      if (insertError) {
        throw new Error(`Failed to insert document chunks: ${insertError.message}`);
      }

      // 5. Update document status to completed
      const { error: updateError } = await db
        .from('kb_documents')
        .update({
          status: 'completed',
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.documentId);

      if (updateError) {
        console.error(`[EmbeddingPipeline] Failed to update document status to completed:`, updateError.message);
      }
    } catch (err: any) {
      console.error(`[EmbeddingPipeline] Processing failed for document ${params.documentId}:`, err.message);

      // Update status to failed
      const { error: failUpdateError } = await db
        .from('kb_documents')
        .update({
          status: 'failed',
          error_message: err.message || 'Unknown processing error',
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.documentId);

      if (failUpdateError) {
        console.error(`[EmbeddingPipeline] Failed to update document status to failed:`, failUpdateError.message);
      }

      throw err;
    }
  }
}

export const embeddingPipeline = new EmbeddingPipeline();
