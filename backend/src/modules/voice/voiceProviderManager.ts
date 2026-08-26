// src/modules/voice/voiceProviderManager.ts

import { AsteriskProvider } from './providers/asterisk/asteriskProvider.js';
import { ProviderStatus } from './providers/asterisk/asteriskProvider.js';

/**
 * Singleton manager for voice providers.
 * Currently supports only the Asterisk provider.
 */
export class VoiceProviderManager {
  private static instance: VoiceProviderManager;
  private asteriskProvider?: AsteriskProvider;
  private enabled: boolean = false;

  private constructor() {}

  static getInstance(): VoiceProviderManager {
    if (!VoiceProviderManager.instance) {
      VoiceProviderManager.instance = new VoiceProviderManager();
    }
    return VoiceProviderManager.instance;
  }

  /**
   * Start all configured voice providers based on environment variables.
   */
  async startVoiceProviders(): Promise<void> {
    const enabled = process.env.ASTERISK_ENABLED === 'true';
    this.enabled = enabled;
    if (!enabled) {
      console.log('[VoiceProviderManager] Voice providers are disabled (ASTERISK_ENABLED=false)');
      return;
    }
    console.log('[VoiceProviderManager] Initializing Asterisk provider');
    this.asteriskProvider = new AsteriskProvider();
    await this.asteriskProvider.connect();
  }

  /**
   * Gracefully stop all providers.
   */
  async stopVoiceProviders(): Promise<void> {
    if (this.asteriskProvider) {
      await this.asteriskProvider.disconnect();
    }
  }

  /**
   * Get current provider status for health reporting.
   */
  getStatus(): ProviderStatus {
    if (!this.enabled) return 'disabled';
    return this.asteriskProvider?.getStatus() ?? 'error';
  }
}
