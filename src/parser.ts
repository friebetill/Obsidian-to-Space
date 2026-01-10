/**
 * Represents an embedded media file in a flashcard
 */
export interface EmbeddedMedia {
  /** Original path in vault (e.g., "attachments/video.mp4") */
  originalPath: string;
  /** Original embed syntax (e.g., "![[video.mp4]]") */
  placeholder: string;
  /** Media type */
  type: 'video' | 'image';
}

/**
 * Represents a parsed flashcard from markdown content
 */
export interface ParsedCard {
  front: string;
  back: string;
  /** Character position in the source file where this card starts */
  startPosition: number;
  /** Character position where this card ends (after the space-id comment if present) */
  endPosition: number;
  /** Space card ID if already synced (from <!-- space-id: xxx --> comment) */
  spaceId: string | null;
  /** Content hash stored in the comment (from last sync) */
  storedHash: string | null;
  /** Current hash of the card content for change detection */
  contentHash: string;
  /** Whether the card content has changed since last sync */
  hasChanged: boolean;
  /** Target deck name from TARGET DECK directive (null = use default) */
  deckName: string | null;
  /** Deck name stored in the comment from last sync (null = default deck) */
  storedDeckName: string | null;
  /** Whether the deck assignment has changed since last sync */
  hasDeckChanged: boolean;
  /** Embedded media files (videos, images) in the card */
  embeddedMedia: EmbeddedMedia[];
}

/**
 * Parses Q:/A: flashcards from markdown content
 *
 * Supported format:
 *   TARGET DECK: My Deck Name
 *
 *   Q: What is the capital of France?
 *   A: Paris
 *   <!-- space-id: cuid123 hash:abc123 -->
 *
 * Multi-line content is supported:
 *   Q: What are the primary colors?
 *   A: The primary colors are:
 *   - Red
 *   - Blue
 *   - Yellow
 *   <!-- space-id: cuid456 hash:def456 -->
 *
 * TARGET DECK can appear multiple times to assign cards to different decks.
 * Cards before any TARGET DECK use the default deck from settings.
 */
export function parseFlashcards(content: string): ParsedCard[] {
  const cards: ParsedCard[] = [];

  // First, find all TARGET DECK directives and their positions
  const deckDirectives: Array<{ position: number; deckName: string }> = [];
  const targetDeckPattern = /^TARGET DECK:\s*(.+)$/gim;
  let deckMatch;
  while ((deckMatch = targetDeckPattern.exec(content)) !== null) {
    deckDirectives.push({
      position: deckMatch.index,
      deckName: deckMatch[1].trim(),
    });
  }

  // Helper to find the deck name for a given position
  const getDeckNameForPosition = (position: number): string | null => {
    let currentDeck: string | null = null;
    for (const directive of deckDirectives) {
      if (directive.position < position) {
        currentDeck = directive.deckName;
      } else {
        break;
      }
    }
    return currentDeck;
  };

  // Regex to match Q: ... A: ... patterns with optional space-id comment
  // Group 1: Question content
  // Group 2: Answer content
  const qaPattern = /Q:\s*([\s\S]*?)(?=\nA:)\nA:\s*([\s\S]*?)(?=\nQ:|\n\n\n|$)/gi;

  let match;
  while ((match = qaPattern.exec(content)) !== null) {
    const front = match[1].trim();
    let back = match[2].trim();
    let spaceId: string | null = null;
    let storedHash: string | null = null;
    let storedDeckName: string | null = null;

    // Check if there's a space-id comment at the end of the back content
    // Format: <!-- space-id: xxx --> or <!-- space-id: xxx hash:yyy --> or <!-- space-id: xxx hash:yyy deck:zzz -->
    const spaceIdMatch = back.match(/<!--\s*space-id:\s*(\S+)(?:\s+hash:(\S+))?(?:\s+deck:(.+?))?\s*-->$/);
    if (spaceIdMatch) {
      spaceId = spaceIdMatch[1];
      storedHash = spaceIdMatch[2] || null;
      storedDeckName = spaceIdMatch[3]?.trim() || null;
      back = back.replace(/\s*<!--\s*space-id:\s*\S+(?:\s+hash:\S+)?(?:\s+deck:.+?)?\s*-->$/, '').trim();
    }

    // Skip empty cards
    if (!front || !back) continue;

    const contentHash = generateHash(front + '||' + back);
    const deckName = getDeckNameForPosition(match.index);

    // Extract embedded media from both front and back
    const frontMedia = extractEmbeddedMedia(front);
    const backMedia = extractEmbeddedMedia(back);
    const embeddedMedia = [...frontMedia, ...backMedia];

    const card: ParsedCard = {
      front,
      back,
      startPosition: match.index,
      endPosition: match.index + match[0].length,
      spaceId,
      storedHash,
      contentHash,
      hasChanged: !storedHash || storedHash !== contentHash,
      deckName,
      storedDeckName,
      hasDeckChanged: deckName !== storedDeckName,
      embeddedMedia,
    };

    cards.push(card);
  }

  return cards;
}

/**
 * Generates a simple hash from a string for change detection
 * Uses a basic hash algorithm - sufficient for detecting content changes
 */
function generateHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Extracts embedded media from content (Obsidian ![[file]] syntax)
 * Supports videos (mp4, webm, mov) and images (png, jpg, jpeg, gif, webp)
 */
function extractEmbeddedMedia(content: string): EmbeddedMedia[] {
  const media: EmbeddedMedia[] = [];
  const videoExtensions = ['mp4', 'webm', 'mov'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
  const allExtensions = [...videoExtensions, ...imageExtensions].join('|');

  // Match Obsidian embed syntax: ![[filename.ext]] or ![[path/to/filename.ext]]
  const pattern = new RegExp(`!\\[\\[([^\\]]+\\.(${allExtensions}))\\]\\]`, 'gi');

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const currentMatch = match; // Capture for closure
    const filePath = currentMatch[1];
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    const type = videoExtensions.includes(extension) ? 'video' : 'image';

    // Avoid duplicates
    if (!media.some(m => m.placeholder === currentMatch[0])) {
      media.push({
        originalPath: filePath,
        placeholder: currentMatch[0],
        type,
      });
    }
  }

  return media;
}

/**
 * Generates the space-id comment to insert after a card
 * Includes content hash for change detection and deck name for deck tracking
 */
export function generateSpaceIdComment(spaceId: string, contentHash: string, deckName: string | null): string {
  const deckPart = deckName ? ` deck:${deckName}` : '';
  return `<!-- space-id: ${spaceId} hash:${contentHash}${deckPart} -->`;
}

/**
 * Inserts or updates space-id comments in the content for synced cards
 * Returns the modified content
 *
 * Format:
 *   Q: Question
 *   A: Answer
 *   <!-- space-id: xxx hash:yyy deck:DeckName -->
 *
 *   Q: Next question
 */
export function updateSpaceComments(
  content: string,
  cardUpdates: Array<{ card: ParsedCard; spaceId: string; isNew: boolean; deckName: string | null }>
): string {
  // Sort by position descending so we can modify from end to start
  // without messing up positions
  const sorted = [...cardUpdates].sort((a, b) => b.card.endPosition - a.card.endPosition);

  let result = content;
  for (const { card, spaceId, isNew, deckName } of sorted) {
    const comment = generateSpaceIdComment(spaceId, card.contentHash, deckName);

    if (isNew) {
      // Insert new comment
      const beforeCard = result.substring(0, card.endPosition);
      const afterCard = result.substring(card.endPosition);

      const trimmedBefore = beforeCard.trimEnd();
      const trimmedAfter = afterCard.trimStart();
      const separator = trimmedAfter.length > 0 ? '\n\n' : '\n';
      result = trimmedBefore + '\n' + comment + separator + trimmedAfter;
    } else {
      // Update existing comment with new hash and deck
      // Find the LAST occurrence of the comment pattern (the one for this card)
      const oldCommentPattern = /<!--\s*space-id:\s*\S+(?:\s+hash:\S+)?(?:\s+deck:.+?)?\s*-->/g;
      const beforeCard = result.substring(0, card.endPosition);
      const afterCard = result.substring(card.endPosition);

      // Find all matches and replace only the last one
      const matches = [...beforeCard.matchAll(oldCommentPattern)];
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        const updatedBefore =
          beforeCard.substring(0, lastMatch.index) +
          comment +
          beforeCard.substring(lastMatch.index! + lastMatch[0].length);
        result = updatedBefore + afterCard;
      }
    }
  }

  return result;
}
