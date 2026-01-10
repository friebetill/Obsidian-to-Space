import {
  App,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  TextComponent,
} from 'obsidian';
import type ObsidianToSpacePlugin from './main';

export interface SpacePluginSettings {
  apiEndpoint: string;
  token: string | null;
  email: string | null;
  defaultDeckName: string;
  defaultDeckId: string | null;
  autoSyncOnSave: boolean;
  lastSyncTime: number | null;
  lastSyncStats: { created: number; updated: number } | null;
  /** Cache of uploaded media: "path:hash" -> s3Url */
  uploadedMedia: Record<string, string>;
}

export const DEFAULT_SETTINGS: SpacePluginSettings = {
  apiEndpoint: 'https://api.getspace.app',
  token: null,
  email: null,
  defaultDeckName: 'Obsidian Flashcards',
  defaultDeckId: null,
  autoSyncOnSave: false,
  lastSyncTime: null,
  lastSyncStats: null,
  uploadedMedia: {},
};

export class SpaceSettingTab extends PluginSettingTab {
  plugin: ObsidianToSpacePlugin;

  constructor(app: App, plugin: ObsidianToSpacePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h1', { text: 'Obsidian to Space' });

    // Account Section
    containerEl.createEl('h2', { text: 'Account' });

    if (this.plugin.settings.token) {
      // Logged in state
      new Setting(containerEl)
        .setName('Logged in')
        .setDesc(`Signed in as ${this.plugin.settings.email}`)
        .addButton((btn) =>
          btn
            .setButtonText('Logout')
            .onClick(async () => {
              this.plugin.settings.token = null;
              this.plugin.settings.email = null;
              this.plugin.apiClient.clearToken();
              await this.plugin.saveSettings();
              this.display();
              new Notice('Logged out from Space');
            })
        );
    } else {
      // Logged out state
      new Setting(containerEl)
        .setName('Not logged in')
        .setDesc('Log in or create a Space account to sync flashcards')
        .addButton((btn) =>
          btn
            .setButtonText('Login')
            .setCta()
            .onClick(() => {
              new LoginModal(this.app, this.plugin, () => this.display()).open();
            })
        )
        .addButton((btn) =>
          btn.setButtonText('Create Account').onClick(() => {
            new SignUpModal(this.app, this.plugin, () => this.display()).open();
          })
        );
    }

    // Sync Settings Section
    containerEl.createEl('h2', { text: 'Sync Settings' });

    new Setting(containerEl)
      .setName('Default deck name')
      .setDesc('Name for the deck where flashcards will be synced')
      .addText((text) =>
        text
          .setPlaceholder('Obsidian Flashcards')
          .setValue(this.plugin.settings.defaultDeckName)
          .onChange(async (value) => {
            this.plugin.settings.defaultDeckName = value || 'Obsidian Flashcards';
            // Clear deck ID so it gets recreated with new name
            this.plugin.settings.defaultDeckId = null;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Auto-sync on save')
      .setDesc('Automatically sync flashcards when you save a file')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSyncOnSave)
          .onChange(async (value) => {
            this.plugin.settings.autoSyncOnSave = value;
            await this.plugin.saveSettings();
          })
      );

    // Manual Sync Section
    containerEl.createEl('h2', { text: 'Manual Sync' });

    new Setting(containerEl)
      .setName('Sync all flashcards')
      .setDesc(this.getLastSyncDescription())
      .addButton((btn) =>
        btn
          .setButtonText('Sync Now')
          .setCta()
          .setDisabled(!this.plugin.settings.token)
          .onClick(async () => {
            await this.plugin.syncAllFlashcards();
            this.display();
          })
      );

    // API Settings (Advanced)
    containerEl.createEl('h2', { text: 'Advanced' });

    new Setting(containerEl)
      .setName('API Endpoint')
      .setDesc('Space API endpoint (only change if self-hosting)')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.apiEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.apiEndpoint = value;
            this.plugin.apiClient = new (await import('./space-api')).SpaceApiClient(value);
            if (this.plugin.settings.token) {
              this.plugin.apiClient.setToken(this.plugin.settings.token);
            }
            await this.plugin.saveSettings();
          })
      );

    // Help section
    containerEl.createEl('h2', { text: 'How to use' });
    const helpDiv = containerEl.createDiv();
    helpDiv.innerHTML = `
      <p>Add flashcards to your notes using the <code>Q:</code> and <code>A:</code> format:</p>
      <pre style="background: var(--background-secondary); padding: 10px; border-radius: 5px;">
Q: What is the capital of France?
A: Paris

Q: What year did WWII end?
A: 1945
      </pre>
      <p>Then run the command <strong>"Sync all flashcards to Space"</strong> or click the cloud icon in the ribbon.</p>
    `;
  }

  private getLastSyncDescription(): string {
    const { lastSyncTime, lastSyncStats } = this.plugin.settings;

    if (!lastSyncTime) {
      return 'Never synced';
    }

    const timeAgo = this.getTimeAgo(lastSyncTime);
    const statsStr = lastSyncStats
      ? ` (${lastSyncStats.created} created, ${lastSyncStats.updated} updated)`
      : '';

    return `Last synced: ${timeAgo}${statsStr}`;
  }

  private getTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  }
}

/**
 * Modal for logging in to Space
 */
class LoginModal extends Modal {
  plugin: ObsidianToSpacePlugin;
  onSuccess: () => void;

  constructor(app: App, plugin: ObsidianToSpacePlugin, onSuccess: () => void) {
    super(app);
    this.plugin = plugin;
    this.onSuccess = onSuccess;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Login to Space' });

    let emailInput: TextComponent;
    let passwordInput: TextComponent;

    new Setting(contentEl).setName('Email').addText((text) => {
      emailInput = text;
      text.setPlaceholder('your@email.com');
    });

    new Setting(contentEl).setName('Password').addText((text) => {
      passwordInput = text;
      text.inputEl.type = 'password';
      text.setPlaceholder('••••••••');
    });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText('Login')
        .setCta()
        .onClick(async () => {
          const email = emailInput.getValue();
          const password = passwordInput.getValue();

          if (!email || !password) {
            new Notice('Please enter email and password');
            return;
          }

          try {
            btn.setDisabled(true);
            btn.setButtonText('Logging in...');

            const result = await this.plugin.apiClient.login(email, password);

            this.plugin.settings.token = result.token;
            this.plugin.settings.email = result.user.email;
            this.plugin.apiClient.setToken(result.token);
            await this.plugin.saveSettings();

            new Notice('Successfully logged in to Space!');
            this.close();
            this.onSuccess();
          } catch (error: any) {
            new Notice(`Login failed: ${error.message}`);
            btn.setDisabled(false);
            btn.setButtonText('Login');
          }
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Modal for creating a new Space account
 */
class SignUpModal extends Modal {
  plugin: ObsidianToSpacePlugin;
  onSuccess: () => void;

  constructor(app: App, plugin: ObsidianToSpacePlugin, onSuccess: () => void) {
    super(app);
    this.plugin = plugin;
    this.onSuccess = onSuccess;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Create Space Account' });

    let firstNameInput: TextComponent;
    let lastNameInput: TextComponent;
    let emailInput: TextComponent;
    let passwordInput: TextComponent;

    new Setting(contentEl).setName('First name').addText((text) => {
      firstNameInput = text;
      text.setPlaceholder('John');
    });

    new Setting(contentEl).setName('Last name').addText((text) => {
      lastNameInput = text;
      text.setPlaceholder('Doe');
    });

    new Setting(contentEl).setName('Email').addText((text) => {
      emailInput = text;
      text.setPlaceholder('your@email.com');
    });

    new Setting(contentEl).setName('Password').addText((text) => {
      passwordInput = text;
      text.inputEl.type = 'password';
      text.setPlaceholder('••••••••');
    });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText('Create Account')
        .setCta()
        .onClick(async () => {
          const firstName = firstNameInput.getValue();
          const lastName = lastNameInput.getValue();
          const email = emailInput.getValue();
          const password = passwordInput.getValue();

          if (!firstName || !lastName || !email || !password) {
            new Notice('Please fill in all fields');
            return;
          }

          if (password.length < 6) {
            new Notice('Password must be at least 6 characters');
            return;
          }

          try {
            btn.setDisabled(true);
            btn.setButtonText('Creating account...');

            const result = await this.plugin.apiClient.signUp(
              email,
              password,
              firstName,
              lastName
            );

            this.plugin.settings.token = result.token;
            this.plugin.settings.email = result.user.email;
            this.plugin.apiClient.setToken(result.token);
            await this.plugin.saveSettings();

            new Notice('Account created! Welcome to Space!');
            this.close();
            this.onSuccess();
          } catch (error: any) {
            new Notice(`Sign up failed: ${error.message}`);
            btn.setDisabled(false);
            btn.setButtonText('Create Account');
          }
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
