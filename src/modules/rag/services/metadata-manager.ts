// src/modules/rag/services/metadata-manager.ts

export type DocType = 'solar_faq' | 'warranty' | 'installation' | 'subsidy' | 'product_spec';

export interface ChunkMetadata {
  title: string;
  doc_type: DocType;
  chunk_index: number;
  total_chunks: number;
  source?: string;
  created_at: string;
  [key: string]: any;
}

export class MetadataManager {
  private allowedTypes: Set<DocType> = new Set([
    'solar_faq',
    'warranty',
    'installation',
    'subsidy',
    'product_spec'
  ]);

  /**
   * Validates if a document type is supported by the Solar EPC knowledge base.
   */
  isValidDocType(type: string): type is DocType {
    return this.allowedTypes.has(type as DocType);
  }

  /**
   * Standardizes and builds metadata structures for document chunks.
   */
  buildMetadata(params: {
    title: string;
    type: string;
    chunkIndex: number;
    totalChunks: number;
    source?: string;
    extra?: Record<string, any>;
  }): ChunkMetadata {
    const docType: DocType = this.isValidDocType(params.type) ? params.type : 'warranty';

    return {
      title: params.title.trim(),
      doc_type: docType,
      chunk_index: params.chunkIndex,
      total_chunks: params.totalChunks,
      source: params.source?.trim() || 'upload',
      created_at: new Date().toISOString(),
      ...(params.extra || {})
    };
  }
}
