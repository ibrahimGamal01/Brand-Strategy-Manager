export type SupportedDocumentParser =
  | 'text'
  | 'csv'
  | 'xlsx'
  | 'docx'
  | 'pptx'
  | 'pdf'
  | 'unknown';

export type CanonicalSection = {
  headingPath: string;
  text: string;
  table?: Record<string, unknown>;
};

export type DocumentParseResult = {
  parser: SupportedDocumentParser;
  text: string;
  sections: CanonicalSection[];
  tables?: Array<Record<string, unknown>>;
  pagesTotal?: number;
  pagesParsed?: number;
  warnings: string[];
  needsReview?: boolean;
};

export type FileDetectionResult = {
  parser: SupportedDocumentParser;
  extension: string;
  mimeType: string;
  isBinary: boolean;
};

export type CanonicalDocument = {
  markdown: string;
  sectionMap: Array<{
    headingPath: string;
    startOffset: number;
    endOffset: number;
  }>;
};

export type DocumentChunk = {
  chunkIndex: number;
  headingPath?: string;
  text: string;
  tokenCount: number;
  tableJson?: Record<string, unknown>;
};
