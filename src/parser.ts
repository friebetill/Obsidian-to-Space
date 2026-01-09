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
  /** A hash of the card content for change detection */
  contentHash: string;
}

/**
 * Parses Q:/A: flashcards from markdown content
 *
 * Supported format:
 *   Q: What is the capital of France?
 *   A: Paris
 *   <!-- space-id: cuid123 -->
 *
 * Multi-line content is supported:
 *   Q: What are the primary colors?
 *   A: The primary colors are:
 *   - Red
 *   - Blue
 *   - Yellow
 *   <!-- space-id: cuid456 -->
 */
export function parseFlashcards(content: string): ParsedCard[] {
  const cards: ParsedCard[] = [];

  // Regex to match Q: ... A: ... patterns with optional space-id comment
  // Group 1: Question content
  // Group 2: Answer content
  // Group 3: Optional space-id value
  const qaPattern = /Q:\s*([\s\S]*?)(?=\nA:)\nA:\s*([\s\S]*?)(?:<!--\s*space-id:\s*(\S+)\s*-->)?(?=\nQ:|\n\n\n|$)/gi;

  let match;
  while ((match = qaPattern.exec(content)) !== null) {
    const front = match[1].trim();
    // Remove trailing space-id comment from back if it was partially captured
    let back = match[2].trim();
    let spaceId = match[3] || null;

    // Check if there's a space-id comment at the end of the back content
    const spaceIdInBack = back.match(/<!--\s*space-id:\s*(\S+)\s*-->$/);
    if (spaceIdInBack) {
      spaceId = spaceIdInBack[1];
      back = back.replace(/\s*<!--\s*space-id:\s*\S+\s*-->$/, '').trim();
    }

    // Skip empty cards
    if (!front || !back) continue;

    const card: ParsedCard = {
      front,
      back,
      startPosition: match.index,
      endPosition: match.index + match[0].length,
      spaceId,
      contentHash: generateHash(front + '||' + back),
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
 */
export function generateSpaceIdComment(spaceId: string): string {
  return `<!-- space-id: ${spaceId} -->`;
}

/**
 * Inserts space-id comments into the content for newly synced cards
 * Returns the modified content
 */
export function insertSpaceIds(
  content: string,
  cardUpdates: Array<{ card: ParsedCard; newSpaceId: string }>
): string {
  // Sort by position descending so we can insert from end to start
  // without messing up positions
  const sorted = [...cardUpdates].sort((a, b) => b.card.endPosition - a.card.endPosition);

  let result = content;
  for (const { card, newSpaceId } of sorted) {
    // Only insert if card doesn't already have a space-id
    if (card.spaceId) continue;

    const comment = `\n${generateSpaceIdComment(newSpaceId)}`;

    // Find the end of this card's content and insert the comment
    // We need to find where the answer ends in the original content
    const beforeCard = result.substring(0, card.endPosition);
    const afterCard = result.substring(card.endPosition);

    result = beforeCard + comment + afterCard;
  }

  return result;
}
