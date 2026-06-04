// src/modules/rag/services/ingestion-pipeline.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { ChunkingService } from './chunking-service';
import { EmbeddingWorker } from './embedding-worker';
import { MetadataManager } from './metadata-manager';

export class IngestionPipeline {
  private chunkingService = new ChunkingService();
  private embeddingWorker = new EmbeddingWorker();
  private metadataManager = new MetadataManager();

  /**
   * Ingests a raw text document by chunking it, generating embeddings,
   * building metadata, and storing it in the database.
   */
  async ingestText(params: {
    kbId: string;
    text: string;
    title: string;
    type: string;
    source?: string;
    extra?: Record<string, any>;
  }): Promise<void> {
    const admin = supabaseAdmin();
    
    // 1. Chunk document
    const chunks = this.chunkingService.chunkText(params.text);
    if (chunks.length === 0) return;

    // 2. Batch generate embeddings using embedding worker (concurrency limited)
    const embeddings = await this.embeddingWorker.generateEmbeddingsInBatches(chunks);

    // 3. Construct and insert chunks with metadata
    const rows = chunks.map((chunk, index) => {
      const metadata = this.metadataManager.buildMetadata({
        title: params.title,
        type: params.type,
        chunkIndex: index,
        totalChunks: chunks.length,
        source: params.source,
        extra: params.extra
      });

      return {
        kb_id: params.kbId,
        content: chunk,
        embedding: embeddings[index],
        metadata
      };
    });

    const { error } = await admin.from('document_chunks').insert(rows);
    if (error) {
      console.error('[IngestionPipeline] Failed to insert document chunks:', error.message);
      throw error;
    }
  }

  /**
   * Ingests a set of FAQs (Question & Answer pairs) by formatting them into chunks,
   * generating embeddings, and storing them in the database.
   */
  async ingestFAQs(params: {
    kbId: string;
    faqs: Array<{ question: string; answer: string }>;
    title: string;
    source?: string;
    extra?: Record<string, any>;
  }): Promise<void> {
    const admin = supabaseAdmin();

    // 1. Chunk FAQs
    const chunks = this.chunkingService.chunkFAQs(params.faqs);
    if (chunks.length === 0) return;

    // 2. Batch generate embeddings
    const embeddings = await this.embeddingWorker.generateEmbeddingsInBatches(chunks);

    // 3. Construct and insert chunks
    const rows = chunks.map((chunk, index) => {
      const metadata = this.metadataManager.buildMetadata({
        title: params.title,
        type: 'solar_faq',
        chunkIndex: index,
        totalChunks: chunks.length,
        source: params.source,
        extra: params.extra
      });

      return {
        kb_id: params.kbId,
        content: chunk,
        embedding: embeddings[index],
        metadata
      };
    });

    const { error } = await admin.from('document_chunks').insert(rows);
    if (error) {
      console.error('[IngestionPipeline] Failed to insert FAQ chunks:', error.message);
      throw error;
    }
  }

  /**
   * Ingests a PDF document by extracting printable text strings,
   * and piping the text into the standard text ingestion pipeline.
   */
  async ingestPDF(params: {
    kbId: string;
    pdfBuffer: Buffer;
    title: string;
    type: string;
    source?: string;
    extra?: Record<string, any>;
  }): Promise<void> {
    const text = await this.extractTextFromPDF(params.pdfBuffer);
    
    if (!text.trim()) {
      throw new Error('PDF extraction returned empty text.');
    }

    await this.ingestText({
      kbId: params.kbId,
      text,
      title: params.title,
      type: params.type,
      source: params.source || 'pdf_upload',
      extra: params.extra
    });
  }

  /**
   * Core bulk ingestion routing to support concurrent upload pipelines.
   */
  async bulkIngest(params: {
    kbId: string;
    documents: Array<
      | { type: 'text'; text: string; title: string; docType: string; source?: string }
      | { type: 'faq'; faqs: Array<{ question: string; answer: string }>; title: string; source?: string }
      | { type: 'pdf'; pdfBuffer: Buffer; title: string; docType: string; source?: string }
    >;
  }): Promise<void> {
    console.log(`[IngestionPipeline] Starting bulk ingestion of ${params.documents.length} files...`);

    for (const doc of params.documents) {
      try {
        if (doc.type === 'text') {
          await this.ingestText({
            kbId: params.kbId,
            text: doc.text,
            title: doc.title,
            type: doc.docType,
            source: doc.source
          });
        } else if (doc.type === 'faq') {
          await this.ingestFAQs({
            kbId: params.kbId,
            faqs: doc.faqs,
            title: doc.title,
            source: doc.source
          });
        } else if (doc.type === 'pdf') {
          await this.ingestPDF({
            kbId: params.kbId,
            pdfBuffer: doc.pdfBuffer,
            title: doc.title,
            type: doc.docType,
            source: doc.source
          });
        }
      } catch (err: any) {
        console.error(`[IngestionPipeline] Bulk ingest item fail ("${doc.title}"):`, err.message);
      }
    }

    console.log('[IngestionPipeline] Bulk ingestion complete.');
  }

  /**
   * Zero-dependency text extraction fallback helper for PDF buffers.
   */
  private async extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
    let text = '';
    try {
      const pdfString = pdfBuffer.toString('binary');
      // Look for PDF parenthesized string content
      const matches = pdfString.match(/\(([^)]+)\)/g) || [];
      const rawText = matches
        .map(m => m.slice(1, -1))
        .filter(str => /^[a-zA-Z0-9\s.,!?:;'"()-]+$/.test(str))
        .join(' ');
      
      text = rawText.trim();
      
      if (text.length < 50) {
        // Fallback: extract any clean printable ASCII string sequences
        text = pdfBuffer
          .toString('utf8')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\xFF]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    } catch {
      text = pdfBuffer.toString('utf8');
    }
    return text;
  }
}
