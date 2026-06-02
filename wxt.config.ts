import { defineConfig } from 'wxt';

// Firefox-only manifest additions. Chrome ignores `browser_specific_settings`
// entirely. This is a personal/unlisted extension (not for AMO), so we keep a
// neutral gecko id and omit `data_collection_permissions` (only required for AMO
// submission, and it conflicts with strict_min_version 128).
const firefoxSettings = {
  browser_specific_settings: {
    gecko: {
      id: 'trawler@local',
      strict_min_version: '128.0', // world:'MAIN' + MV3 require Firefox 128+
    },
  },
} as Record<string, unknown>;

export default defineConfig({
  // Build MV3 for both engines (Firefox 128+ supports MV3 + MAIN-world scripts).
  manifestVersion: 3,
  // Prefer explicit `#imports` over auto-imports for reviewability.
  imports: false,
  manifest: ({ browser }) => ({
    name: 'Trawler',
    description:
      'Capture browser verification context (console / network / interactions / DOM / sockets) and export a fact-only bundle for Claude Code.',
    permissions: ['storage', 'downloads', 'clipboardWrite', 'activeTab'],
    host_permissions: ['<all_urls>'],
    // Expose the MAIN-world inject script so injectScript() can load it.
    web_accessible_resources: [{ resources: ['inject.js'], matches: ['<all_urls>'] }],
    action: {
      default_title: 'Trawler',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    commands: {
      'open-panel': {
        suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
        description: 'Open the Trawler side panel',
      },
      checkpoint: {
        suggested_key: { default: 'Alt+Shift+Y' },
        description: 'Drop a Trawler checkpoint on the active tab',
      },
      'toggle-picker': {
        suggested_key: { default: 'Alt+Shift+P' },
        description: 'Toggle the Trawler element picker on the active tab',
      },
    },
    ...(browser === 'firefox' ? firefoxSettings : {}),
  }),
});
