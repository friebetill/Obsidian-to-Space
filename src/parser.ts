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
  /** CardGroup name from TARGET DECK directive (null = no group) */
  groupName: string | null;
  /** Group name stored from last sync (null = no group) */
  storedGroupName: string | null;
  /** Whether the group assignment has changed since last sync */
  hasGroupChanged: boolean;
  /** Embedded media files (videos, images) in the card */
  embeddedMedia: EmbeddedMedia[];
}

/**
 * Checks whether the file has a CARD ORDER directive.
 * When present, cards should be learned in the order they appear in the file.
 * The directive is ignored inside fenced code blocks.
 */
export function isFileOrdered(content: string): boolean {
  const contentWithoutCodeBlocks = content.replace(/```[\s\S]*?```/g, (match) =>
    ' '.repeat(match.length)
  );
  return /^CARD ORDER$/m.test(contentWithoutCodeBlocks);
}

/**
 * Parses Q:/A: flashcards from markdown content
 *
 * Supported format:
 *   TARGET DECK: My Deck Name
 *
 *   Q: What is the capital of France?
 *   A: Paris
 *   <!-- id: cuid123 -->
 *
 * Multi-line content is supported:
 *   Q: What are the primary colors?
 *   A: The primary colors are:
 *   - Red
 *   - Blue
 *   - Yellow
 *   <!-- id: cuid456 -->
 *
 * TARGET DECK can appear multiple times to assign cards to different decks.
 * Cards before any TARGET DECK use the default deck from settings.
 *
 * Note: Fenced code blocks (```) are ignored to avoid parsing examples/templates.
 * Hash and deck metadata are stored in plugin settings, not in comments.
 * Also supports legacy format: <!-- space-id: xxx hash:yyy deck:zzz -->
 */
export function parseFlashcards(content: string): ParsedCard[] {
  const cards: ParsedCard[] = [];

  // Remove fenced code blocks to avoid parsing example/template flashcards
  // Replace with placeholder of same length to preserve positions
  const contentWithoutCodeBlocks = content.replace(/```[\s\S]*?```/g, (match) =>
    ' '.repeat(match.length)
  );

  // First, find all TARGET DECK directives and their positions
  // Format: TARGET DECK: DeckName or TARGET DECK: DeckName:GroupName
  const deckDirectives: Array<{ position: number; deckName: string; groupName: string | null }> = [];
  const targetDeckPattern = /^TARGET DECK:\s*(.+)$/gim;
  let deckMatch;
  while ((deckMatch = targetDeckPattern.exec(contentWithoutCodeBlocks)) !== null) {
    const rawValue = deckMatch[1].trim();
    // Split by first colon to separate deck name from group name
    const colonIndex = rawValue.indexOf(':');
    let deckName: string;
    let groupName: string | null = null;
    if (colonIndex !== -1) {
      deckName = rawValue.substring(0, colonIndex).trim();
      groupName = rawValue.substring(colonIndex + 1).trim() || null;
    } else {
      deckName = rawValue;
    }
    deckDirectives.push({
      position: deckMatch.index,
      deckName,
      groupName,
    });
  }

  // Helper to find the deck and group name for a given position
  const getDeckInfoForPosition = (position: number): { deckName: string | null; groupName: string | null } => {
    let currentDeck: string | null = null;
    let currentGroup: string | null = null;
    for (const directive of deckDirectives) {
      if (directive.position < position) {
        currentDeck = directive.deckName;
        currentGroup = directive.groupName;
      } else {
        break;
      }
    }
    return { deckName: currentDeck, groupName: currentGroup };
  };

  // Regex to match Q: ... A: ... patterns with optional space-id comment
  // Group 1: Question content
  // Group 2: Answer content
  const qaPattern = /Q:\s*([\s\S]*?)(?=\nA:)\nA:\s*([\s\S]*?)(?=\nQ:|\n\n\n|$)/gi;

  let match;
  while ((match = qaPattern.exec(contentWithoutCodeBlocks)) !== null) {
    // Use original content at same positions (positions preserved since we used same-length replacement)
    const originalMatch = content.substring(match.index, match.index + match[0].length);
    const originalParsed = originalMatch.match(/Q:\s*([\s\S]*?)(?=\nA:)\nA:\s*([\s\S]*?)$/i);
    if (!originalParsed) continue;

    const front = originalParsed[1].trim();
    let back = originalParsed[2].trim();
    let spaceId: string | null = null;
    let storedHash: string | null = null;
    let storedDeckName: string | null = null;

    // Check for new format: <!-- id: xxx -->
    const newIdMatch = back.match(/<!--\s*id:\s*(\S+)\s*-->$/);
    if (newIdMatch) {
      spaceId = newIdMatch[1];
      back = back.replace(/\s*<!--\s*id:\s*\S+\s*-->$/, '').trim();
    } else {
      // Check for legacy format: <!-- space-id: xxx hash:yyy deck:zzz -->
      const legacyMatch = back.match(/<!--\s*space-id:\s*(\S+)(?:\s+hash:(\S+))?(?:\s+deck:(.+?))?\s*-->$/);
      if (legacyMatch) {
        spaceId = legacyMatch[1];
        storedHash = legacyMatch[2] || null;
        storedDeckName = legacyMatch[3]?.trim() || null;
        back = back.replace(/\s*<!--\s*space-id:\s*\S+(?:\s+hash:\S+)?(?:\s+deck:.+?)?\s*-->$/, '').trim();
      }
    }

    // Skip empty cards
    if (!front || !back) continue;

    const contentHash = generateHash(front + '||' + back);
    const { deckName, groupName } = getDeckInfoForPosition(match.index);

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
      groupName,
      storedGroupName: null, // Will be populated from settings in sync.ts
      hasGroupChanged: false, // Will be calculated in sync.ts
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
 * Generates the id comment to insert after a card
 * Only contains the Space card ID - hash and deck are stored in settings
 */
export function generateIdComment(spaceId: string): string {
  return `<!-- id: ${spaceId} -->`;
}

/**
 * Inserts or updates id comments in the content for synced cards
 * Returns the modified content
 *
 * Format:
 *   Q: Question
 *   A: Answer
 *   <!-- id: xxx -->
 *
 *   Q: Next question
 */
export function updateSpaceComments(
  content: string,
  cardUpdates: Array<{ card: ParsedCard; spaceId: string; isNew: boolean }>
): string {
  // Sort by position descending so we can modify from end to start
  // without messing up positions
  const sorted = [...cardUpdates].sort((a, b) => b.card.endPosition - a.card.endPosition);

  let result = content;
  for (const { card, spaceId, isNew } of sorted) {
    const comment = generateIdComment(spaceId);

    if (isNew) {
      // Insert new comment
      const beforeCard = result.substring(0, card.endPosition);
      const afterCard = result.substring(card.endPosition);

      const trimmedBefore = beforeCard.trimEnd();
      const trimmedAfter = afterCard.trimStart();
      const separator = trimmedAfter.length > 0 ? '\n\n' : '\n';
      result = trimmedBefore + '\n' + comment + separator + trimmedAfter;
    } else {
      // Update existing comment (supports both new and legacy formats)
      // Find the LAST occurrence of either comment pattern
      const oldCommentPattern = /<!--\s*(?:id:\s*\S+|space-id:\s*\S+(?:\s+hash:\S+)?(?:\s+deck:.+?)?)\s*-->/g;
      const beforeCard = result.substring(0, card.endPosition);
      const afterCard = result.substring(card.endPosition);

      // Find all matches and replace only the last one
      const matches = [...beforeCard.matchAll(oldCommentPattern)];
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        const matchIndex = lastMatch.index ?? 0;
        const updatedBefore =
          beforeCard.substring(0, matchIndex) +
          comment +
          beforeCard.substring(matchIndex + lastMatch[0].length);
        result = updatedBefore + afterCard;
      }
    }
  }

  return result;
}
