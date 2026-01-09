/**
 * Represents a parsed flashcard from markdown content
 */
export interface ParsedCard {
  front: string;
  back: string;
  /** Character position in the source file where this card starts */
  position: number;
  /** A hash of the card content for change detection */
  contentHash: string;
}

/**
 * Parses Q:/A: flashcards from markdown content
 *
 * Supported format:
 *   Q: What is the capital of France?
 *   A: Paris
 *
 * Multi-line content is supported:
 *   Q: What are the primary colors?
 *   A: The primary colors are:
 *   - Red
 *   - Blue
 *   - Yellow
 */
export function parseFlashcards(content: string): ParsedCard[] {
  const cards: ParsedCard[] = [];

  // Remove code blocks to avoid parsing Q:/A: inside them
  const contentWithoutCode = removeCodeBlocks(content);

  // Regex to match Q: ... A: ... patterns
  // Captures everything after Q: until A:, and everything after A: until next Q: or end
  const qaPattern = /Q:\s*([\s\S]*?)(?=\nA:)\nA:\s*([\s\S]*?)(?=\nQ:|\n\n\n|$)/gi;

  let match;
  while ((match = qaPattern.exec(contentWithoutCode)) !== null) {
    const front = match[1].trim();
    const back = match[2].trim();

    // Skip empty cards
    if (!front || !back) continue;

    const card: ParsedCard = {
      front,
      back,
      position: match.index,
      contentHash: generateHash(front + '||' + back),
    };

    cards.push(card);
  }

  return cards;
}

/**
 * Removes fenced code blocks and inline code from content
 * to prevent parsing Q:/A: that appears in code examples
 */
function removeCodeBlocks(content: string): string {
  // Remove fenced code blocks (```...```)
  let result = content.replace(/```[\s\S]*?```/g, '');

  // Remove inline code (`...`)
  result = result.replace(/`[^`]+`/g, '');

  return result;
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
 * Generates a unique local ID for a card based on file path and content
 * Used to match cards across syncs without relying on Space IDs
 */
export function generateLocalCardId(filePath: string, card: ParsedCard): string {
  return generateHash(filePath + '::' + card.front + '||' + card.back);
}
