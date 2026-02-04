# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**This is a living document.** Claude Code should update this file when discovering new patterns, conventions, or important information about the codebase that would be valuable for future sessions.

## Project Overview

This is an Obsidian plugin that syncs flashcards written in markdown to the Space spaced-repetition learning app. Users write flashcards using `Q:` / `A:` syntax in their Obsidian notes, and the plugin syncs them to Space via GraphQL API.

## Commands

```bash
npm install              # Install dependencies
npm run dev              # Build and watch for changes (development)
npm run build            # Production build (type-check + bundle)
npm run version          # Bump version in manifest.json and versions.json
```

## Architecture

### Source Files (`src/`)

- **main.ts** - Plugin entry point. Registers commands ("Sync all flashcards", "Sync current file") and ribbon icon. Initializes `SpaceApiClient` and `SyncEngine`.

- **parser.ts** - Parses `Q:` / `A:` flashcards from markdown content. Handles `TARGET DECK:` directives for multi-deck and CardGroup support. Extracts embedded media (`![[file]]` syntax). Generates content hashes for change detection. Ignores flashcards inside fenced code blocks.

- **sync.ts** - `SyncEngine` orchestrates syncing. Reads files via Obsidian Vault API, calls parser, resolves deck/group names to IDs (creating decks/groups if needed), uploads media, calls API to upsert cards, and updates files with `<!-- id: xxx -->` tracking comments.

- **space-api.ts** - GraphQL client using Obsidian's `requestUrl` (bypasses CORS). Handles auth (login/signup), deck operations (`upsertDeck`, `searchDecks`), group operations (`getGroupsForDeck`, `createGroup`), card operations (`upsertCard`, `upsertCards`, `deleteCard`), and S3 pre-signed URLs for media upload. Includes rate limiting (20 requests per 5 seconds).

- **media-uploader.ts** - Uploads images/videos to S3 via pre-signed URLs. Caches uploaded media by `path:hash` to avoid re-uploading unchanged files.

- **settings.ts** - Plugin settings tab with login/signup modals. Stores auth token, deck config, and card metadata (content hashes, deck/group assignments) in Obsidian's data store.

### Flashcard Format

```markdown
TARGET DECK: My Deck Name

Q: Question text
A: Answer text (can be multi-line)
<!-- id: cuid123 -->
```

With CardGroup support:
```markdown
TARGET DECK: Spanish Vocabulary:Spanish to German

Q: Hola
A: Hallo
<!-- id: cuid456 -->
```

- `TARGET DECK: DeckName` - assigns cards to a deck (no group)
- `TARGET DECK: DeckName:GroupName` - assigns cards to a deck and CardGroup within it
- Cards are tracked via `<!-- id: xxx -->` comments (inserted after sync)
- Card metadata (content hash, deck name, group name) stored in plugin settings, not in comments
- Legacy format `<!-- space-id: xxx hash:yyy deck:zzz -->` is auto-migrated

### Build Output

- `main.js` - Bundled plugin (esbuild, CJS format)
- `manifest.json` - Plugin metadata for Obsidian
- `styles.css` - Plugin styles (if any)
