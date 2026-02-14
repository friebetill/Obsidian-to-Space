import { TFile } from 'obsidian';
import type ObsidianToSpacePlugin from './main';
import { SpaceApiClient } from './space-api';
import { parseFlashcards, updateSpaceComments, ParsedCard } from './parser';
import { getOrUploadMedia } from './media-uploader';

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
  /** Cache of `${deckId}:${groupName}` -> group ID resolved during sync */
  private groupIdCache: Map<string, string> = new Map();

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

    // Clear caches at start of sync
    this.deckIdCache.clear();
    this.groupIdCache.clear();

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
      } catch (error) {
        result.errors.push(`Error syncing ${file.path}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

    // Group cards by deck name AND group name
    // Key format: `${deckName ?? '__default__'}::${groupName ?? '__nogroup__'}`
    const cardsByDeckAndGroup = new Map<string, { deckName: string | null; groupName: string | null; cards: ParsedCard[] }>();
    for (const card of cards) {
      const key = `${card.deckName ?? '__default__'}::${card.groupName ?? '__nogroup__'}`;
      if (!cardsByDeckAndGroup.has(key)) {
        cardsByDeckAndGroup.set(key, { deckName: card.deckName, groupName: card.groupName, cards: [] });
      }
      cardsByDeckAndGroup.get(key)!.cards.push(card);
    }

    // Track cards that need comment updates
    const cardUpdates: Array<{ card: ParsedCard; spaceId: string; isNew: boolean }> = [];
    // Track metadata updates for settings
    const metadataUpdates: Array<{ spaceId: string; contentHash: string; deckName: string | null; groupName: string | null }> = [];
    // Track all synced card positions for reordering by file position
    // (includes both newly synced and previously synced/skipped cards)
    const allCardPositions: Array<{ startPosition: number; spaceId: string; deckId: string }> = [];

    // Process each deck/group combination
    for (const [, { deckName, groupName, cards: groupCards }] of cardsByDeckAndGroup) {
      // Resolve deck ID
      let deckId: string;
      if (deckName === null) {
        deckId = defaultDeckId;
      } else {
        try {
          deckId = await this.resolveDeckId(deckName);
        } catch (error) {
          result.errors.push(`Error resolving deck "${deckName}": ${error instanceof Error ? error.message : 'Unknown error'}`);
          continue;
        }
      }

      // Resolve group ID if groupName is set
      let groupId: string | undefined;
      if (groupName) {
        try {
          groupId = await this.resolveGroupId(deckId, groupName);
        } catch (error) {
          result.errors.push(`Error resolving group "${groupName}" in deck "${deckName || 'default'}": ${error instanceof Error ? error.message : 'Unknown error'}`);
          continue;
        }
      }

      // Separate cards into those that need syncing and those to skip
      const cardsToSync: Array<{ card: ParsedCard; isNew: boolean }> = [];

      for (const card of groupCards) {
        // Look up stored metadata from settings if card has spaceId
        let storedHash = card.storedHash;
        let storedDeckName = card.storedDeckName;
        let storedGroupName: string | null = null;
        const hasMetadataInSettings = card.spaceId && this.plugin.settings.cardMetadata[card.spaceId];

        if (hasMetadataInSettings) {
          const metadata = this.plugin.settings.cardMetadata[card.spaceId!];
          storedHash = metadata.contentHash;
          storedDeckName = metadata.deckName;
          storedGroupName = metadata.groupName;
        }

        // Check if this is a legacy card that needs migration (has storedHash from parsing but not in settings)
        const needsMigration = card.spaceId && card.storedHash && !hasMetadataInSettings;

        const hasChanged = !storedHash || storedHash !== card.contentHash;
        const hasDeckChanged = deckName !== storedDeckName;
        const hasGroupChanged = groupName !== storedGroupName;

        if (needsMigration) {
          // Migrate legacy card: update comment format and store metadata in settings
          cardUpdates.push({ card, spaceId: card.spaceId!, isNew: false });
          metadataUpdates.push({
            spaceId: card.spaceId!,
            contentHash: card.storedHash!,
            deckName: card.storedDeckName,
            groupName: null, // Legacy cards didn't have groups
          });
          allCardPositions.push({ startPosition: card.startPosition, spaceId: card.spaceId!, deckId });
          result.skipped++; // Count as skipped since content didn't change
        } else if (card.spaceId && !hasChanged && !hasDeckChanged && !hasGroupChanged) {
          // Card unchanged and in same deck/group, skip
          allCardPositions.push({ startPosition: card.startPosition, spaceId: card.spaceId!, deckId });
          result.skipped++;
        } else {
          cardsToSync.push({ card, isNew: !card.spaceId });
        }
      }

      // Batch sync cards if there are any to sync
      if (cardsToSync.length > 0) {
        try {
          // Process embedded media for each card
          const batchInput = await Promise.all(
            cardsToSync.map(async ({ card }) => {
              let front = card.front;
              let back = card.back;

              // Upload embedded media and replace placeholders
              for (const media of card.embeddedMedia) {
                const uploadResult = await getOrUploadMedia(
                  this.plugin.app.vault,
                  media.originalPath,
                  this.plugin.settings,
                  this.apiClient,
                  () => this.plugin.saveSettings()
                );

                if (uploadResult.success && uploadResult.url) {
                  // Replace Obsidian embed with markdown image/video syntax for Space
                  // Format: ![filename](url) - Space app detects .mp4 URLs and renders as video
                  const filename = media.originalPath.split('/').pop() || 'media';
                  const markdownEmbed = `![${filename}](${uploadResult.url})`;
                  front = front.split(media.placeholder).join(markdownEmbed);
                  back = back.split(media.placeholder).join(markdownEmbed);
                } else if (uploadResult.error) {
                  console.warn(`Failed to upload ${media.originalPath}: ${uploadResult.error}`);
                }
              }

              return {
                front,
                back,
                id: card.spaceId || undefined,
              };
            })
          );

          const syncedCards = await this.apiClient.upsertCards(deckId, batchInput, groupId);

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
            metadataUpdates.push({
              spaceId: syncedCard.id,
              contentHash: card.contentHash,
              deckName,
              groupName,
            });
            allCardPositions.push({ startPosition: card.startPosition, spaceId: syncedCard.id, deckId });
          }
        } catch (error) {
          result.errors.push(`Error batch syncing cards to "${deckName || 'default'}${groupName ? `:${groupName}` : ''}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // Update comments for synced cards and save metadata to settings
    if (cardUpdates.length > 0) {
      try {
        // Update file with new id comments
        const updatedContent = updateSpaceComments(content, cardUpdates);
        await this.plugin.app.vault.modify(file, updatedContent);

        // Save metadata to settings
        for (const { spaceId, contentHash, deckName, groupName } of metadataUpdates) {
          this.plugin.settings.cardMetadata[spaceId] = { contentHash, deckName, groupName };
        }
        await this.plugin.saveSettings();
      } catch (error) {
        result.errors.push(`Error updating file with ids: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Reorder cards by their position in the file
    if (allCardPositions.length > 0) {
      // Group card IDs by deck, sorted by file position
      const cardsByDeck = new Map<string, string[]>();
      const sorted = [...allCardPositions].sort((a, b) => a.startPosition - b.startPosition);
      for (const { spaceId, deckId } of sorted) {
        if (!cardsByDeck.has(deckId)) {
          cardsByDeck.set(deckId, []);
        }
        cardsByDeck.get(deckId)!.push(spaceId);
      }

      for (const [deckId, cardIds] of cardsByDeck) {
        try {
          await this.apiClient.reorderCards(deckId, cardIds, 0);
        } catch (error) {
          result.errors.push(`Error reordering cards in deck ${deckId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
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
   * Resolve a group name to a group ID within a deck, creating if necessary
   * Results are cached for the duration of the sync
   */
  private async resolveGroupId(deckId: string, groupName: string): Promise<string> {
    const cacheKey = `${deckId}:${groupName}`;

    // Check cache first
    if (this.groupIdCache.has(cacheKey)) {
      return this.groupIdCache.get(cacheKey)!;
    }

    // Try to find existing group with this name
    const existingGroups = await this.apiClient.getGroupsForDeck(deckId);
    const matchingGroup = existingGroups.find(
      (g) => g.name.toLowerCase() === groupName.toLowerCase()
    );

    let groupId: string;
    if (matchingGroup) {
      groupId = matchingGroup.id;
    } else {
      // Create new group
      const newGroup = await this.apiClient.createGroup(deckId, groupName);
      groupId = newGroup.id;
    }

    // Cache the result
    this.groupIdCache.set(cacheKey, groupId);
    return groupId;
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
