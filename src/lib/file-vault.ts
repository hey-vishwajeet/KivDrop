const filesBySession = new Map<string, File[]>();

export function holdFiles(sessionId: string, files: File[]): void {
  filesBySession.set(sessionId, files);
}

export function getHeldFiles(sessionId: string): File[] {
  return filesBySession.get(sessionId) ?? [];
}

export function releaseFiles(sessionId: string): void {
  filesBySession.delete(sessionId);
}
