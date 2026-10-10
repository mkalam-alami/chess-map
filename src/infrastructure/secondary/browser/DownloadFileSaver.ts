import type { FileSaver } from '../../../application';

/** Saves a file through a temporary download link. */
export class DownloadFileSaver implements FileSaver {
  /** `doc` defaults to the global document, looked up when saving. */
  constructor(private readonly doc?: Document) {}

  save(filename: string, content: string, mimeType: string): void {
    const doc = this.doc ?? document;
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
    a.download = filename;
    doc.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
