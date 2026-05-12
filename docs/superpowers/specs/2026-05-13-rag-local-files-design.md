# RAG (Local Files) — Design Spec

**Date:** 2026-05-13  
**Feature:** P1 — RAG (Retrieval-Augmented Generation) for local files  
**Status:** Approved for implementation

---

## Goal

Let users index local files (`.txt`, `.md`, `.pdf`) into a local vector store. Every chat message automatically searches the index and injects the most relevant chunks as context, with source citations appended to the assistant's reply.

---

## Architecture Overview

```
User drops file(s) → Dashboard "Knowledge Base" tab
        ↓
rag-store.ts — parse file (text / PDF) → chunk into ~400 word segments (1 sentence overlap)
        ↓
embed each chunk via nomic-embed-text (Ollama /api/embeddings)
        ↓
LanceDB table: userData/contextchat-rag/
  columns: id, content, source, chunkIndex, vector

On CHAT_SEND (always-on):
        ↓
embed user message → cosine search → top-3 chunks
        ↓
inject as context block into system prompt (after memories, before user message)
        ↓
after streamChat completes → if chunks used, append "---\n📄 Sources: file1, file2" to assistant reply
```

**Separate from memory store:** RAG uses its own `contextchat-rag/` LanceDB table. The existing `nomic-embed-text` embedding pipeline is reused via a shared `embedText()` helper extracted from `memory-store.ts`.

---

## Data Model

### RagChunk (internal to rag-store.ts — never exposed to renderer)

```typescript
interface RagChunk {
  id: string;           // uuid
  content: string;      // raw text of this chunk
  source: string;       // original filename, e.g. "notes.md"
  chunkIndex: number;   // 0-based position within the file
  vector: Float32Array; // nomic-embed-text embedding
}
```

### RAG list entry (returned to renderer)

```typescript
interface RagFile {
  source: string;   // filename
  chunks: number;   // number of indexed chunks
}
```

---

## Chunking Strategy

- Split by double-newline (paragraph boundaries) first
- Hard-cap each chunk at 400 words; split long paragraphs at sentence boundaries
- 1-sentence overlap between adjacent chunks to preserve context across boundaries
- Minimum chunk size: 10 words (discard smaller fragments)

---

## File Parsers

| Extension | Parser | Dependency |
|---|---|---|
| `.txt`, `.md` | `fs.readFile` → UTF-8 string | none |
| `.pdf` | `pdf-parse` npm package | `pdf-parse` |

`pdf-parse` has no native binaries — safe inside asar.

---

## Components

### `electron/rag-store.ts` (new)

Single responsibility: LanceDB read/write/search for RAG chunks.

```typescript
// Public API:
initRagStore(): Promise<void>
ingestFile(filePath: string, ollamaUrl: string): Promise<{ chunks: number }>
listRagFiles(): Promise<RagFile[]>
deleteRagFile(source: string): Promise<void>
ragSearch(query: string, ollamaUrl: string, topK?: number): Promise<RagChunk[]>  // topK default 3
```

- DB path: `app.getPath('userData')/contextchat-rag/`
- Embedding: reuses shared `embedText(text, ollamaUrl)` helper (extracted from `memory-store.ts`)
- Before ingesting a file, delete all existing chunks with the same `source` (re-index on re-add)
- If Ollama is not running during search: return `[]`, never throw

### `electron/rag-ipc.ts` (new)

Single responsibility: register RAG IPC handlers. Called from `main.ts` once.

```typescript
// Registers: RAG_INGEST, RAG_LIST, RAG_DELETE, RAG_SEARCH
registerRagIpc(): void
```

### `electron/ipc-channels.ts` (modify)

Add 4 channels to the `IPC` object:

```typescript
RAG_INGEST: 'rag:ingest',   // handle(filePaths: string[]) → { indexed: number; skipped: string[] }
RAG_LIST:   'rag:list',     // handle() → RagFile[]
RAG_DELETE: 'rag:delete',   // handle(source: string) → void
RAG_SEARCH: 'rag:search',   // handle(query: string) → RagChunk[]  (debug only)
```

### `electron/main.ts` (modify)

**App startup:** call `initRagStore()` alongside `initMemoryStore()`.

**CHAT_SEND handler** — after memory search, before `streamChat`:

```typescript
const ragChunks = await ragSearch(
  payload.userMessage.content as string,
  settings.ollamaUrl,
).catch(() => [] as RagChunk[]);

const ragBlock = ragChunks.length > 0
  ? `\nRelevant context from user's knowledge base:\n${ragChunks.map(c => c.content).join('\n\n')}`
  : '';

// Prepend ragBlock to the first system message (after memory block, before existing system content)
```

**After streamChat completes** — if `ragChunks.length > 0`, append to `assistantBuffer`:

```typescript
const uniqueSources = [...new Set(ragChunks.map(c => c.source))];
assistantBuffer += `\n\n---\n📄 Sources: ${uniqueSources.join(', ')}`;
```

Import `registerRagIpc` and call it inside `registerIpc()`.

### `src/shared/types.ts` (modify)

Export `RagFile` interface for renderer use:

```typescript
export interface RagFile {
  source: string;
  chunks: number;
}
```

### `src/dashboard/tabs/KnowledgeBase.tsx` (new)

Dashboard tab with:

- HTML5 drag-and-drop zone + hidden `<input type="file" multiple accept=".txt,.md,.pdf">`
- Clicking the zone opens file picker
- On file selection: call `RAG_INGEST`, show per-file "Indexing…" spinner in component state
- Indexed files list: filename, chunk count, Remove button (calls `RAG_DELETE`, reloads list)
- Empty state: "No files indexed yet. Drop files here to add them to your knowledge base."
- Error state: toast-style inline message if ingest fails (e.g. Ollama not running)

### `src/dashboard/Dashboard.tsx` (modify)

Add "Knowledge Base" tab between History and Memories tabs.

---

## System Prompt Injection Format

RAG context is injected between the memory block and the existing system prompt content:

```
What you remember about this user:
- User is building ContextChat with Electron

Relevant context from user's knowledge base:
[chunk 1 text]

[chunk 2 text]

[existing system prompt: "You are a helpful AI assistant..."]
```

---

## Citations Format

Appended to the assistant's reply text after `streamChat` completes:

```
---
📄 Sources: notes.md, report.pdf
```

Only shown when at least one RAG chunk was injected. Unique filenames only (deduplicated).

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Ollama not running during ingest | Return error to UI; show inline error "Embedding failed — is Ollama running?" |
| Ollama not running during search | Return `[]`; chat proceeds without RAG injection |
| `pdf-parse` fails on a file | Skip that file; include filename in `skipped[]` return value |
| File is empty or < 10 words total | Skip; include in `skipped[]` |
| No files indexed | `ragSearch` returns `[]`; no injection, no citation line |
| LanceDB table missing | Auto-created by `initRagStore()` on startup |

---

## Dependencies

| Package | Purpose | Notes |
|---|---|---|
| `pdf-parse` | Parse PDF files to text | No native binaries, safe in asar |
| `@lancedb/lancedb` | Vector store | Already installed (P0) |
| `apache-arrow` | LanceDB peer dep | Already installed (P0) |

Only one new dependency: `pdf-parse`.

---

## What This Does NOT Do

- No folder watching / auto-indexing (user manually adds files)
- No Word (.docx) support in this version
- No web URL ingestion
- No per-collection KB (one global KB for all conversations)
- No re-indexing detection (re-adding a file fully re-indexes it)
- No memory of which KB chunks were used (citations are display-only, not stored in history)

---

## File Summary

| File | Action |
|---|---|
| `electron/rag-store.ts` | Create |
| `electron/rag-ipc.ts` | Create |
| `electron/ipc-channels.ts` | Modify — add 4 RAG channels |
| `electron/main.ts` | Modify — init RAG store, wire RAG search into CHAT_SEND, register RAG IPC |
| `electron/memory-store.ts` | Modify — extract `embedText()` as exported helper |
| `src/shared/types.ts` | Modify — add RagFile interface |
| `src/dashboard/tabs/KnowledgeBase.tsx` | Create |
| `src/dashboard/Dashboard.tsx` | Modify — add Knowledge Base tab |
| `package.json` | Modify — add pdf-parse |
