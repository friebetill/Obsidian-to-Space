# Space Flashcards

Sync your flashcards from [Obsidian](https://obsidian.md) to [Space](https://getspace.app) for spaced repetition learning on any device.

## Features

- **Simple syntax**: Write flashcards using `Q:` and `A:` in your notes
- **Multi-deck support**: Use `TARGET DECK:` to organize cards into different decks
- **One-click sync**: Sync all flashcards with a single command
- **In-plugin auth**: Create a Space account or log in without leaving Obsidian
- **Smart tracking**: Cards are tracked via comments, so you can edit content freely
- **Cross-platform learning**: Study your cards in the Space app on iOS, Android, macOS, Windows, or Linux

## Installation

### From Obsidian Community Plugins (coming soon)

1. Open Obsidian Settings → Community Plugins
2. Search for "Space Flashcards"
3. Click Install, then Enable

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/friebetill/obsidian-to-space/releases)
2. Extract to your vault's `.obsidian/plugins/obsidian-to-space/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

## Usage

### 1. Create an Account

1. Open Settings → Space Flashcards
2. Click "Create Account" or "Login"
3. Enter your credentials

### 2. Write Flashcards

Add flashcards anywhere in your notes using the `Q:` and `A:` format:

```markdown
# My Study Notes

Some regular notes here...

Q: What is the capital of France?
A: Paris

Q: What year did World War II end?
A: 1945

More notes can go here...
```

Multi-line answers are supported:

```markdown
Q: What are the primary colors?
A: The three primary colors are:
- Red
- Blue
- Yellow
```

### Organizing Cards into Decks

Use `TARGET DECK:` to specify which deck cards should sync to:

```markdown
TARGET DECK: Spanish Vocabulary

Q: How do you say "hello" in Spanish?
A: Hola

Q: How do you say "goodbye" in Spanish?
A: Adiós

TARGET DECK: French Vocabulary

Q: How do you say "hello" in French?
A: Bonjour
```

- Cards after a `TARGET DECK:` line sync to that deck
- You can use multiple `TARGET DECK:` directives in one file
- Cards before any `TARGET DECK:` use the default deck from settings
- Decks are created automatically if they don't exist

### 3. Sync to Space

Either:
- Click the cloud icon in the left ribbon
- Run the command "Sync all flashcards to Space" (Ctrl/Cmd + P)
- Use "Sync current file to Space" for a single file

### 4. Study in Space

Open the [Space app](https://getspace.app) on any device to study your flashcards with spaced repetition.

## How Tracking Works

After syncing, the plugin adds a tracking comment after each card:

```markdown
Q: What is the capital of France?
A: Paris
<!-- space-id: cktx1234abcd -->
```

This allows you to:
- **Edit cards freely** - changing the question or answer updates the existing card
- **Move cards between files** - the tracking stays with the card
- **See sync status** - cards without comments haven't been synced yet

> **Tip**: Don't delete the `<!-- space-id: ... -->` comments unless you want to create a new card in Space.

## Commands

| Command | Description |
|---------|-------------|
| Sync all flashcards to Space | Scan all markdown files and sync flashcards |
| Sync current file to Space | Sync only the active file |

## Settings

| Setting | Description |
|---------|-------------|
| Default deck name | Name of the deck where cards are synced (default: "Obsidian Flashcards") |
| Auto-sync on save | Automatically sync when you save a file (coming soon) |

## FAQ

### Can I sync to multiple decks?

Yes! Use the `TARGET DECK:` directive to specify which deck cards should sync to. See [Organizing Cards into Decks](#organizing-cards-into-decks) for details.

### What happens if I delete a card in Obsidian?

The card remains in Space. To delete it from Space, use the Space app directly.

### Can I sync cards from Space back to Obsidian?

No, this is a one-way sync (Obsidian → Space). Obsidian is the source of truth.

### Does it work with other flashcard formats?

Currently only `Q:` / `A:` format is supported. More formats (like `::` syntax, cloze deletions) are planned.

## Support

- [Report issues](https://github.com/friebetill/obsidian-to-space/issues)
- [Space website](https://getspace.app)
- [Obsidian Discord](https://discord.gg/obsidianmd)

## License

MIT License - see [LICENSE](LICENSE) for details.
