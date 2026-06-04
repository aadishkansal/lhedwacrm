import * as pdf from 'pdf-parse';
import mammoth from 'mammoth';

export interface FAQItem {
  question: string;
  answer: string;
}

export class DocumentProcessor {
  /**
   * Main text extraction entry point.
   */
  async extractText(buffer: Buffer, fileType: 'pdf' | 'docx' | 'txt' | 'faq' | 'markdown'): Promise<string> {
    switch (fileType) {
      case 'txt':
      case 'markdown':
        return this.parseText(buffer);
      case 'pdf':
        return this.parsePDF(buffer);
      case 'docx':
        return this.parseDOCX(buffer);
      case 'faq':
        // For FAQs, if requested as raw text, we format Q&As into structured text blocks
        const faqs = this.parseFAQ(buffer);
        return faqs.map(f => `Question: ${f.question}\nAnswer: ${f.answer}`).join('\n\n');
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
  }

  /**
   * Parse plain text or markdown files.
   */
  private parseText(buffer: Buffer): string {
    return buffer.toString('utf8');
  }

  /**
   * Parse PDF files using PDFParse constructor.
   */
  private async parsePDF(buffer: Buffer): Promise<string> {
    try {
      const PDFParse = (pdf as any).PDFParse || (pdf as any).default?.PDFParse;
      if (!PDFParse) {
        // Fallback to legacy function call
        const data = await (pdf as any)(buffer);
        return data.text || '';
      }
      const instance = new PDFParse(new Uint8Array(buffer));
      await instance.load();
      const data = await instance.getText();
      return data.text || '';
    } catch (err: any) {
      throw new Error(`Failed to parse PDF: ${err.message}`);
    }
  }

  /**
   * Parse DOCX files.
   */
  private async parseDOCX(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    } catch (err: any) {
      throw new Error(`Failed to parse DOCX: ${err.message}`);
    }
  }

  /**
   * Parse FAQ files (JSON formatted array of question/answer pairs).
   */
  parseFAQ(buffer: Buffer): FAQItem[] {
    try {
      const raw = buffer.toString('utf8').trim();
      const parsed = JSON.parse(raw);
      
      if (!Array.isArray(parsed)) {
        throw new Error('FAQ content must be a JSON array of Q&As');
      }

      for (const item of parsed) {
        if (typeof item.question !== 'string' || typeof item.answer !== 'string') {
          throw new Error('Each FAQ item must contain string question and answer fields');
        }
      }

      return parsed as FAQItem[];
    } catch (err: any) {
      throw new Error(`Failed to parse FAQ JSON: ${err.message}`);
    }
  }
}

export const documentProcessor = new DocumentProcessor();
