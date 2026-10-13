/** A file or text could not be imported; the message is meant to be shown to the user as is. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** The cloud refuses the stored sign-in (expired, revoked, never granted): the user has to connect again. */
export class CloudAuthError extends Error {
  constructor(message = 'Not signed in') {
    super(message);
    this.name = 'CloudAuthError';
  }
}
