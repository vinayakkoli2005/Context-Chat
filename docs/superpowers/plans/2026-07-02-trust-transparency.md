# Trust & Transparency Features — Implementation Plan

**Goal:** Make ContextChat's "trust" promise true — every answer shows exactly which memories and documents it used, each is deletable in one click, and users can wipe all memory at once.

**Architecture:** The chat pipeline already retrieves `memories` (searchMemories) and `ragChunks` (ragSearch) in `main.ts` CHAT_SEND but only appends sources as plain text. We surface that retrieval as structured metadata on the assistant `Message`, render it in the panel with inline forget buttons (reusing existing `MEMORY_DELETE` / `RAG_DELETE` channels), and add a `MEMORY_PURGE` for wipe-all. Preload is a generic passthrough, so no allowlist changes are needed.

**Tech Stack:** Electron + React + TypeScript, LanceDB stores.

---

## Decisions (locked, no approval needed)

- **Used-context strip** appears under each assistant answer that used ≥1 memory or source. Collapsed by default: `🔎 Used N memories · M sources`. Expands to rows, each with a 🗑 forget button.
- **Forget** is immediate and permanent (memory → `MEMORY_DELETE`, source → `RAG_DELETE`); the row greys out to "Forgotten".
- **Memories tab** gains a header showing the count and a **Forget everything** button (confirm dialog) → `MEMORY_PURGE`.
- **Website:** add prominent catchy security tagline `Zero cloud. Zero leaks. Zero trust issues.` to the hero.
- Structured used-context replaces the plain-text `📄 Sources:` footer (cleaner; data now lives on the message object and in history).

## File structure

- `src/shared/types.ts` — extend `Message`, add `UsedMemory`.
- `electron/ipc-channels.ts` — add `MEMORY_PURGE`.
- `electron/memory-store.ts` — add `clearAllMemories`.
- `electron/main.ts` — CHAT_SEND emits structured used-context; add MEMORY_PURGE handler.
- `src/panel/UsedContext.tsx` — new component (strip + forget).
- `src/panel/ChatHistory.tsx` — render UsedContext per assistant message.
- `src/panel/Panel.tsx` — attach CHAT_DONE payload to the assistant message.
- `src/dashboard/tabs/Memories.tsx` — count + Forget-everything.
- `website/index.html` — hero tagline.

## Tasks

1. **Website tagline** — add the security line to the hero.
2. **Types** — `UsedMemory = { id; content; type }`; `Message.usedMemories?`, `Message.usedSources?`.
3. **main.ts** — build `usedMemories`/`usedSources`, send in `CHAT_DONE`, store on the assistant message; drop the text footer.
4. **UsedContext.tsx** — collapsible strip with per-item forget.
5. **ChatHistory + Panel** — render strip; attach CHAT_DONE payload to message state.
6. **Purge backend** — `MEMORY_PURGE` channel + `clearAllMemories` + handler.
7. **Memories tab** — count header + Forget-everything button.
8. **Verify** — `tsc --noEmit` + `electron-vite build`, then commit & push.

## Success criteria

- Ask a question that hits memory/RAG → answer shows the used strip; expanding lists the exact items.
- Forget a memory/source → it disappears and is not used in the next answer.
- Memories tab shows count and can wipe all with confirmation.
- Build is green; website shows the new tagline.
