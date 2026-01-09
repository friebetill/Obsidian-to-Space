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

    return result.data.login;
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

    return result.data.signUp;
  }

  /**
   * Create or update a deck
   */
  async upsertDeck(name: string, id?: string): Promise<SpaceDeck> {
    const query = `
      mutation UpsertDeck($name: String!, $id: String) {
        upsertDeck(name: $name, id: $id) {
          id
          name
          description
        }
      }
    `;

    const result = await this.executeGraphQLWithRateLimit(query, { name, id });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to create/update deck');
    }

    return result.data.upsertDeck;
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
      mutation UpsertCard($deckId: String!, $front: String!, $back: String!, $id: String) {
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
      id,
    });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to create/update card');
    }

    return result.data.upsertCard;
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
   * Search for decks
   */
  async searchDecks(searchTerm: string = '', first: number = 100): Promise<SpaceDeck[]> {
    const query = `
      query SearchDecks($searchTerm: String!, $first: Int) {
        searchDecks(searchTerm: $searchTerm, first: $first) {
          edges {
            node {
              id
              name
              description
            }
          }
        }
      }
    `;

    const result = await this.executeGraphQL(query, { searchTerm, first });

    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'Failed to search decks');
    }

    return result.data.searchDecks.edges.map((edge: any) => edge.node);
  }

  /**
   * Execute a GraphQL query with rate limiting
   */
  private async executeGraphQLWithRateLimit(
    query: string,
    variables: Record<string, any>
  ): Promise<any> {
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
    variables: Record<string, any>
  ): Promise<any> {
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
    } catch (error: any) {
      if (error.status === 401) {
        throw new Error('Session expired. Please log in again.');
      }
      throw new Error(`API request failed: ${error.message}`);
    }
  }
}
