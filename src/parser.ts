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
}

/**
 * Parses Q:/A: flashcards from markdown content
 *
 * Supported format:
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
 */
export function parseFlashcards(content: string): ParsedCard[] {
  const cards: ParsedCard[] = [];

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

    // Check if there's a space-id comment at the end of the back content
    // Format: <!-- space-id: xxx --> or <!-- space-id: xxx hash:yyy -->
    const spaceIdMatch = back.match(/<!--\s*space-id:\s*(\S+)(?:\s+hash:(\S+))?\s*-->$/);
    if (spaceIdMatch) {
      spaceId = spaceIdMatch[1];
      storedHash = spaceIdMatch[2] || null;
      back = back.replace(/\s*<!--\s*space-id:\s*\S+(?:\s+hash:\S+)?\s*-->$/, '').trim();
    }

    // Skip empty cards
    if (!front || !back) continue;

    const contentHash = generateHash(front + '||' + back);

    const card: ParsedCard = {
      front,
      back,
      startPosition: match.index,
      endPosition: match.index + match[0].length,
      spaceId,
      storedHash,
      contentHash,
      hasChanged: !storedHash || storedHash !== contentHash,
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
 * Generates the space-id comment to insert after a card
 * Includes content hash for change detection
 */
export function generateSpaceIdComment(spaceId: string, contentHash: string): string {
  return `<!-- space-id: ${spaceId} hash:${contentHash} -->`;
}

/**
 * Inserts or updates space-id comments in the content for synced cards
 * Returns the modified content
 *
 * Format:
 *   Q: Question
 *   A: Answer
 *   <!-- space-id: xxx hash:yyy -->
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
    const comment = generateSpaceIdComment(spaceId, card.contentHash);

    if (isNew) {
      // Insert new comment
      const beforeCard = result.substring(0, card.endPosition);
      const afterCard = result.substring(card.endPosition);

      const trimmedBefore = beforeCard.trimEnd();
      const trimmedAfter = afterCard.trimStart();
      const separator = trimmedAfter.length > 0 ? '\n\n' : '\n';
      result = trimmedBefore + '\n' + comment + separator + trimmedAfter;
    } else {
      // Update existing comment with new hash
      // Find the LAST occurrence of the comment pattern (the one for this card)
      const oldCommentPattern = /<!--\s*space-id:\s*\S+(?:\s+hash:\S+)?\s*-->/g;
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
