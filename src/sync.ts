import { TFile } from 'obsidian';
import type ObsidianToSpacePlugin from './main';
import { SpaceApiClient } from './space-api';
import { parseFlashcards, updateSpaceComments, ParsedCard } from './parser';

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Orchestrates syncing flashcards from Obsidian to Space
 */
export class SyncEngine {
  private plugin: ObsidianToSpacePlugin;
  private apiClient: SpaceApiClient;
  /** Cache of deck name -> deck ID resolved during sync */
  private deckIdCache: Map<string, string> = new Map();

  constructor(plugin: ObsidianToSpacePlugin, apiClient: SpaceApiClient) {
    this.plugin = plugin;
    this.apiClient = apiClient;
  }

  /**
   * Sync all markdown files in the vault
   */
  async syncAll(): Promise<SyncResult> {
    const result: SyncResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    // Clear deck cache at start of sync
    this.deckIdCache.clear();

    // Ensure we have a default deck to sync to
    await this.ensureDefaultDeck();

    // Get all markdown files
    const files = this.plugin.app.vault.getMarkdownFiles();

    for (const file of files) {
      try {
        const fileResult = await this.syncFile(file);
        result.created += fileResult.created;
        result.updated += fileResult.updated;
        result.skipped += fileResult.skipped;
        result.errors.push(...fileResult.errors);
      } catch (error: any) {
        result.errors.push(`Error syncing ${file.path}: ${error.message}`);
      }
    }

    // Update last sync time
    this.plugin.settings.lastSyncTime = Date.now();
    this.plugin.settings.lastSyncStats = {
      created: result.created,
      updated: result.updated,
    };
    await this.plugin.saveSettings();

    return result;
  }

  /**
   * Sync a single file
   */
  async syncFile(file: TFile): Promise<SyncResult> {
    const result: SyncResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    // Read file content
    const content = await this.plugin.app.vault.read(file);

    // Parse flashcards
    const cards = parseFlashcards(content);

    if (cards.length === 0) {
      return result;
    }

    // Ensure we have a default deck
    await this.ensureDefaultDeck();
    const defaultDeckId = this.plugin.settings.defaultDeckId;

    if (!defaultDeckId) {
      result.errors.push('No deck available for syncing');
      return result;
    }

    // Group cards by deck name (null = default deck)
    const cardsByDeck = new Map<string | null, ParsedCard[]>();
    for (const card of cards) {
      const deckKey = card.deckName;
      if (!cardsByDeck.has(deckKey)) {
        cardsByDeck.set(deckKey, []);
      }
      cardsByDeck.get(deckKey)!.push(card);
    }

    // Track cards that need comment updates
    const cardUpdates: Array<{ card: ParsedCard; spaceId: string; isNew: boolean }> = [];

    // Process each deck group
    for (const [deckName, deckCards] of cardsByDeck) {
      // Resolve deck ID
      let deckId: string;
      if (deckName === null) {
        deckId = defaultDeckId;
      } else {
        try {
          deckId = await this.resolveDeckId(deckName);
        } catch (error: any) {
          result.errors.push(`Error resolving deck "${deckName}": ${error.message}`);
          continue;
        }
      }

      // Separate cards into those that need syncing and those to skip
      const cardsToSync: Array<{ card: ParsedCard; isNew: boolean }> = [];

      for (const card of deckCards) {
        if (card.spaceId && !card.hasChanged) {
          // Card unchanged, skip
          result.skipped++;
        } else {
          cardsToSync.push({ card, isNew: !card.spaceId });
        }
      }

      // Batch sync cards if there are any to sync
      if (cardsToSync.length > 0) {
        try {
          const batchInput = cardsToSync.map(({ card }) => ({
            front: card.front,
            back: card.back,
            id: card.spaceId || undefined,
          }));

          const syncedCards = await this.apiClient.upsertCards(deckId, batchInput);

          // Map results back to original cards
          for (let i = 0; i < cardsToSync.length; i++) {
            const { card, isNew } = cardsToSync[i];
            const syncedCard = syncedCards[i];

            if (isNew) {
              result.created++;
            } else {
              result.updated++;
            }

            cardUpdates.push({ card, spaceId: syncedCard.id, isNew });
          }
        } catch (error: any) {
          result.errors.push(`Error batch syncing cards to "${deckName || 'default'}": ${error.message}`);
        }
      }
    }

    // Update comments for synced cards (new cards get comments, updated cards get new hash)
    if (cardUpdates.length > 0) {
      try {
        const updatedContent = updateSpaceComments(content, cardUpdates);
        await this.plugin.app.vault.modify(file, updatedContent);
      } catch (error: any) {
        result.errors.push(`Error updating file with space-ids: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Resolve a deck name to a deck ID, creating if necessary
   * Results are cached for the duration of the sync
   */
  private async resolveDeckId(deckName: string): Promise<string> {
    // Check cache first
    if (this.deckIdCache.has(deckName)) {
      return this.deckIdCache.get(deckName)!;
    }

    // Try to find existing deck with this name
    const existingDecks = await this.apiClient.searchDecks(deckName);
    const matchingDeck = existingDecks.find(
      (d) => d.name.toLowerCase() === deckName.toLowerCase()
    );

    let deckId: string;
    if (matchingDeck) {
      deckId = matchingDeck.id;
    } else {
      // Create new deck
      const newDeck = await this.apiClient.upsertDeck(deckName);
      deckId = newDeck.id;
    }

    // Cache the result
    this.deckIdCache.set(deckName, deckId);
    return deckId;
  }

  /**
   * Ensure the default deck exists in Space
   */
  private async ensureDefaultDeck(): Promise<void> {
    // If we already have a deck ID, we're good
    if (this.plugin.settings.defaultDeckId) {
      return;
    }

    const deckName = this.plugin.settings.defaultDeckName;

    // Try to find existing deck with this name
    const existingDecks = await this.apiClient.searchDecks(deckName);
    const matchingDeck = existingDecks.find(
      (d) => d.name.toLowerCase() === deckName.toLowerCase()
    );

    if (matchingDeck) {
      this.plugin.settings.defaultDeckId = matchingDeck.id;
    } else {
      // Create new deck
      const newDeck = await this.apiClient.upsertDeck(deckName);
      this.plugin.settings.defaultDeckId = newDeck.id;
    }

    await this.plugin.saveSettings();
  }
}
