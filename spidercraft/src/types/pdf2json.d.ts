declare module 'pdf2json' {
  import { EventEmitter } from 'events';

  export default class PDFParser extends EventEmitter {
    loadPDF(pdfFilePath: string, verbosity?: number): void;
  }
}
