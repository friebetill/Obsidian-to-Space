import { requestUrl } from 'obsidian';

export interface AuthPayload {
  token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

export interface SpaceCard {
  id: string;
  front: string;
  back: string;
}

export interface SpaceDeck {
  id: string;
  name: string;
  description?: string;
}

export interface SpaceGroup {
  id: string;
  name: string;
}

interface GraphQLResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

/**
 * GraphQL client for the Space API
 * Uses Obsidian's requestUrl to bypass CORS restrictions
 */
export class SpaceApiClient {
  private apiEndpoint: string;
  private token: string | null = null;

  // Rate limiting: max 20 requests per 5 seconds
  private requestQueue: Array<() => Promise<void>> = [];
  private requestsInWindow = 0;
  private windowStart = Date.now();
  private readonly MAX_REQUESTS = 20;
  private readonly WINDOW_MS = 5000;

  constructor(apiEndpoint: string) {
    this.apiEndpoint = apiEndpoint;
  }

  setToken(token: string) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  isAuthenticated(): boolean {
    return this.token !== null;
  }

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<AuthPayload> {
    const query = `
      mutation Login($email: String!, $password: String!) {
        login(email: $email, password: $password) {
          token
          user {
            id
            email
            firstName
            lastName
          }
        }
      }
    `;

    const result = await this.executeGraphQL(query, { email, password });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Login failed');
    }

    return (result.data as { login: AuthPayload }).login;
  }

  /**
   * Create a new account
   */
  async signUp(
    email: string,
    password: string,
    firstName: string,
    lastName: string
  ): Promise<AuthPayload> {
    const query = `
      mutation SignUp($email: String!, $password: String!, $firstName: String!, $lastName: String!) {
        signUp(email: $email, password: $password, firstName: $firstName, lastName: $lastName) {
          token
          user {
            id
            email
            firstName
            lastName
          }
        }
      }
    `;

    const result = await this.executeGraphQL(query, {
      email,
      password,
      firstName,
      lastName,
    });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Sign up failed');
    }

    return (result.data as { signUp: AuthPayload }).signUp;
  }

  /**
   * Create or update a deck
   */
  async upsertDeck(name: string, id?: string): Promise<SpaceDeck> {
    const query = `
      mutation UpsertDeck($name: String!, $description: String!, $createMirrorCard: Boolean!, $id: ID) {
        upsertDeck(name: $name, description: $description, createMirrorCard: $createMirrorCard, id: $id) {
          id
          name
          description
        }
      }
    `;

    const result = await this.executeGraphQLWithRateLimit(query, {
      name,
      description: '',
      createMirrorCard: false,
      id: id || null
    });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to create/update deck');
    }

    return (result.data as { upsertDeck: SpaceDeck }).upsertDeck;
  }

  /**
   * Create or update a card
   */
  async upsertCard(
    deckId: string,
    front: string,
    back: string,
    id?: string
  ): Promise<SpaceCard> {
    const query = `
      mutation UpsertCard($deckId: ID!, $front: String!, $back: String!, $id: ID) {
        upsertCard(deckId: $deckId, front: $front, back: $back, id: $id) {
          id
          front
          back
        }
      }
    `;

    const result = await this.executeGraphQLWithRateLimit(query, {
      deckId,
      front,
      back,
      id: id || null,
    });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to create/update card');
    }

    return (result.data as { upsertCard: SpaceCard }).upsertCard;
  }

  /**
   * Create or update multiple cards in a single batch
   */
  async upsertCards(
    deckId: string,
    cards: Array<{ front: string; back: string; id?: string }>,
    groupId?: string
  ): Promise<SpaceCard[]> {
    const query = `
      mutation UpsertCards($deckId: ID!, $cards: [CardInput!]!, $groupId: ID) {
        upsertCards(deckId: $deckId, cards: $cards, groupId: $groupId) {
          id
          front
          back
        }
      }
    `;

    const result = await this.executeGraphQLWithRateLimit(query, {
      deckId,
      cards: cards.map((c) => ({
        id: c.id || null,
        front: c.front,
        back: c.back,
      })),
      groupId: groupId || null,
    });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to batch create/update cards');
    }

    return (result.data as { upsertCards: SpaceCard[] }).upsertCards;
  }

  /**
   * Get all groups for a deck
   */
  async getGroupsForDeck(deckId: string): Promise<SpaceGroup[]> {
    const query = `
      query GetDeckGroups($id: ID!) {
        deck(id: $id) {
          groups {
            id
            name
          }
        }
      }
    `;

    const result = await this.executeGraphQL(query, { id: deckId });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to get deck groups');
    }

    return (result.data as { deck: { groups: SpaceGroup[] } }).deck.groups;
  }

  /**
   * Create a new group in a deck
   */
  async createGroup(deckId: string, name: string): Promise<SpaceGroup> {
    const query = `
      mutation CreateGroup($deckId: ID!, $name: String!) {
        createGroup(deckId: $deckId, name: $name) {
          id
          name
        }
      }
    `;

    const result = await this.executeGraphQLWithRateLimit(query, { deckId, name });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to create group');
    }

    return (result.data as { createGroup: SpaceGroup }).createGroup;
  }

  /**
   * Delete a card
   */
  async deleteCard(id: string): Promise<void> {
    const query = `
      mutation DeleteCard($id: String!) {
        deleteCard(id: $id) {
          id
        }
      }
    `;

    const result = await this.executeGraphQLWithRateLimit(query, { id });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to delete card');
    }
  }

  /**
   * Get pre-signed S3 PUT URL for uploading a file (CORS-friendly)
   * Returns the upload URL and public URL
   */
  async getPreSignedS3PutUrl(key: string, contentType: string): Promise<{
    uploadUrl: string;
    publicUrl: string;
  }> {
    const query = `
      mutation GetPreSignedS3PutUrl($key: String!, $contentType: String!) {
        getPreSignedS3PutUrl(key: $key, contentType: $contentType)
      }
    `;

    const result = await this.executeGraphQLWithRateLimit(query, { key, contentType });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to get upload URL');
    }

    // The API returns a JSON string that we need to parse
    return JSON.parse((result.data as { getPreSignedS3PutUrl: string }).getPreSignedS3PutUrl);
  }

  /**
   * Search for decks
   */
  async searchDecks(searchTerm: string = '', first: number = 100): Promise<SpaceDeck[]> {
    const query = `
      query SearchDecks($searchTerm: String!, $first: Int!) {
        searchDecks(searchTerm: $searchTerm, first: $first) {
          nodes {
            id
            name
            description
          }
        }
      }
    `;

    const result = await this.executeGraphQL(query, { searchTerm, first });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to search decks');
    }

    return (result.data as { searchDecks: { nodes: SpaceDeck[] } }).searchDecks.nodes;
  }

  /**
   * Execute a GraphQL query with rate limiting
   */
  private async executeGraphQLWithRateLimit(
    query: string,
    variables: Record<string, unknown>
  ): Promise<GraphQLResponse> {
    // Check rate limit
    const now = Date.now();
    if (now - this.windowStart > this.WINDOW_MS) {
      // Reset window
      this.windowStart = now;
      this.requestsInWindow = 0;
    }

    if (this.requestsInWindow >= this.MAX_REQUESTS) {
      // Wait for window to reset
      const waitTime = this.WINDOW_MS - (now - this.windowStart);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      this.windowStart = Date.now();
      this.requestsInWindow = 0;
    }

    this.requestsInWindow++;
    return this.executeGraphQL(query, variables);
  }

  /**
   * Execute a GraphQL query
   */
  private async executeGraphQL(
    query: string,
    variables: Record<string, unknown>
  ): Promise<GraphQLResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await requestUrl({
        url: this.apiEndpoint,
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      });

      return response.json;
    } catch (error) {
      const err = error as { status?: number; message?: string };
      if (err.status === 401) {
        throw new Error('Session expired. Please log in again.');
      }
      throw new Error(`API request failed: ${err.message || 'Unknown error'}`);
    }
  }
}
