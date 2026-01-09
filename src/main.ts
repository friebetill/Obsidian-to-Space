import { Notice, Plugin } from 'obsidian';
import { SpaceSettingTab, SpacePluginSettings, DEFAULT_SETTINGS } from './settings';
import { SpaceApiClient } from './space-api';
import { parseFlashcards } from './parser';
import { SyncEngine } from './sync';

export default class ObsidianToSpacePlugin extends Plugin {
  settings: SpacePluginSettings;
  apiClient: SpaceApiClient;
  syncEngine: SyncEngine;

  async onload() {
    await this.loadSettings();

    this.apiClient = new SpaceApiClient(this.settings.apiEndpoint);
    if (this.settings.token) {
      this.apiClient.setToken(this.settings.token);
    }

    this.syncEngine = new SyncEngine(this, this.apiClient);

    // Add settings tab
    this.addSettingTab(new SpaceSettingTab(this.app, this));

    // Add command: Sync all flashcards
    this.addCommand({
      id: 'sync-all-flashcards',
      name: 'Sync all flashcards to Space',
      callback: () => this.syncAllFlashcards(),
    });

    // Add command: Sync current file
    this.addCommand({
      id: 'sync-current-file',
      name: 'Sync current file to Space',
      callback: () => this.syncCurrentFile(),
    });

    // Add ribbon icon
    this.addRibbonIcon('upload-cloud', 'Sync to Space', () => {
      this.syncAllFlashcards();
    });

    console.log('Obsidian to Space plugin loaded!');
  }

  onunload() {
    console.log('Obsidian to Space plugin unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async syncAllFlashcards() {
    if (!this.settings.token) {
      new Notice('Please log in to Space first (Settings → Obsidian to Space)');
      return;
    }

    try {
      new Notice('Starting sync to Space...');
      const result = await this.syncEngine.syncAll();
      new Notice(`Synced ${result.created} new, ${result.updated} updated cards to Space!`);
    } catch (error) {
      console.error('Sync failed:', error);
      new Notice(`Sync failed: ${error.message}`);
    }
  }

  async syncCurrentFile() {
    if (!this.settings.token) {
      new Notice('Please log in to Space first (Settings → Obsidian to Space)');
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('No active file to sync');
      return;
    }

    if (activeFile.extension !== 'md') {
      new Notice('Can only sync markdown files');
      return;
    }

    try {
      new Notice(`Syncing ${activeFile.name}...`);
      const result = await this.syncEngine.syncFile(activeFile);
      new Notice(`Synced ${result.created} new, ${result.updated} updated cards!`);
    } catch (error) {
      console.error('Sync failed:', error);
      new Notice(`Sync failed: ${error.message}`);
    }
  }
}
