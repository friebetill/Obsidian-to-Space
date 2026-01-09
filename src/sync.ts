import { TFile } from 'obsidian';
import type ObsidianToSpacePlugin from './main';
import { SpaceApiClient } from './space-api';
import { parseFlashcards, generateLocalCardId, ParsedCard } from './parser';

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
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
      deleted: 0,
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
        result.deleted += fileResult.deleted;
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
      deleted: 0,
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

    // Sync each card
    for (const card of cards) {
      try {
        const syncResult = await this.syncCard(file.path, card, deckId);
        if (syncResult === 'created') {
          result.created++;
        } else if (syncResult === 'updated') {
          result.updated++;
        }
      } catch (error: any) {
        result.errors.push(`Error syncing card: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Sync a single card to Space
   */
  private async syncCard(
    filePath: string,
    card: ParsedCard,
    deckId: string
  ): Promise<'created' | 'updated' | 'skipped'> {
    const localId = generateLocalCardId(filePath, card);

    // Check if we've synced this card before
    const existingSpaceId = this.plugin.settings.cardMappings[localId];

    if (existingSpaceId) {
      // Update existing card
      await this.apiClient.upsertCard(deckId, card.front, card.back, existingSpaceId);
      return 'updated';
    } else {
      // Create new card
      const spaceCard = await this.apiClient.upsertCard(deckId, card.front, card.back);

      // Store the mapping
      this.plugin.settings.cardMappings[localId] = spaceCard.id;
      await this.plugin.saveSettings();

      return 'created';
    }
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
