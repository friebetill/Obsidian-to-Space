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

interface CardSyncResult {
  action: 'created' | 'updated' | 'skipped';
  spaceId: string;
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

    // Track cards that need comment updates
    const cardUpdates: Array<{ card: ParsedCard; spaceId: string; isNew: boolean }> = [];

    // Sync each card
    for (const card of cards) {
      try {
        const syncResult = await this.syncCard(card, deckId);
        if (syncResult.action === 'created') {
          result.created++;
          cardUpdates.push({ card, spaceId: syncResult.spaceId, isNew: true });
        } else if (syncResult.action === 'updated') {
          result.updated++;
          cardUpdates.push({ card, spaceId: syncResult.spaceId, isNew: false });
        } else {
          result.skipped++;
        }
      } catch (error: any) {
        result.errors.push(`Error syncing card: ${error.message}`);
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
   * Sync a single card to Space
   */
  private async syncCard(card: ParsedCard, deckId: string): Promise<CardSyncResult> {
    if (card.spaceId) {
      // Card already synced - check if it changed
      if (!card.hasChanged) {
        // No changes, skip
        return { action: 'skipped', spaceId: card.spaceId };
      }
      // Card changed, update it
      const spaceCard = await this.apiClient.upsertCard(
        deckId,
        card.front,
        card.back,
        card.spaceId
      );
      return { action: 'updated', spaceId: spaceCard.id };
    } else {
      // New card, create it
      const spaceCard = await this.apiClient.upsertCard(deckId, card.front, card.back);
      return { action: 'created', spaceId: spaceCard.id };
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
