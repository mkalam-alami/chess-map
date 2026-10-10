/** A file or text could not be imported; the message is meant to be shown to the user as is. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}
