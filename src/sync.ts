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

    // Ensure we have a deck to sync to
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

    // Ensure we have a deck
    await this.ensureDefaultDeck();
    const deckId = this.plugin.settings.defaultDeckId;

    if (!deckId) {
      result.errors.push('No deck available for syncing');
      return result;
    }

    // Separate cards into those that need syncing and those to skip
    const cardsToSync: Array<{ card: ParsedCard; isNew: boolean }> = [];

    for (const card of cards) {
      if (card.spaceId && !card.hasChanged) {
        // Card unchanged, skip
        result.skipped++;
      } else {
        cardsToSync.push({ card, isNew: !card.spaceId });
      }
    }

    // Track cards that need comment updates
    const cardUpdates: Array<{ card: ParsedCard; spaceId: string; isNew: boolean }> = [];

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
        result.errors.push(`Error batch syncing cards: ${error.message}`);
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
