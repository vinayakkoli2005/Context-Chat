import { ipcMain } from 'electron';
import { IPC } from './ipc-channels';
import { getSettings } from './store';
import { ingestFile, listRagFiles, deleteRagFile, ragSearch } from './rag-store';
import path from 'path';

export function registerRagIpc(): void {
  // RAG_INGEST: receives array of absolute file paths
  // For each file: call ingestFile(), collect results
  // Return { indexed: number, skipped: string[] }
  // If ingestFile throws for a file: add its basename to skipped[], continue with next file
  ipcMain.handle(IPC.RAG_INGEST, async (_e, filePaths: string[]) => {
    const { ollamaUrl } = getSettings();
    let indexed = 0;
    const skipped: string[] = [];
    for (const fp of filePaths) {
      try {
        const result = await ingestFile(fp, ollamaUrl);
        indexed += result.chunks;
      } catch (err) {
        console.warn(`RAG ingest failed for ${fp}:`, err);
        skipped.push(path.basename(fp));
      }
    }
    return { indexed, skipped };
  });

  // RAG_LIST: returns all indexed files with chunk counts
  ipcMain.handle(IPC.RAG_LIST, async () => {
    return listRagFiles().catch(() => []);
  });

  // RAG_DELETE: deletes all chunks for the given source filename
  ipcMain.handle(IPC.RAG_DELETE, async (_e, source: string) => {
    await deleteRagFile(source).catch(err => console.warn('RAG delete failed:', err));
  });

  // RAG_SEARCH: debug-only search endpoint
  ipcMain.handle(IPC.RAG_SEARCH, async (_e, query: string) => {
    const { ollamaUrl } = getSettings();
    return ragSearch(query, ollamaUrl).catch(() => []);
  });
}
