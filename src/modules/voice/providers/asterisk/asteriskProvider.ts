// src/modules/voice/providers/asterisk/asteriskProvider.ts

import { VoiceProvider, CallStartedEvent, CallAnsweredEvent, CallEndedEvent } from '../../voiceProvider.js';
import { AsteriskAdapter } from './asteriskAdapter.js';

export type ProviderStatus = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'error';

export class AsteriskProvider implements VoiceProvider {
  private adapter: AsteriskAdapter;

  constructor() {
    this.adapter = new AsteriskAdapter();
  }

  async connect(): Promise<void> {
    await this.adapter.connect();
  }

  async disconnect(): Promise<void> {
    this.adapter.disconnect();
  }

  getStatus(): ProviderStatus {
    return this.adapter.getStatus();
  }

  // Outbound call methods are not supported in this phase
  async startCall(_payload: any): Promise<CallStartedEvent> {
    return Promise.reject(new Error('Outbound startCall not supported by AsteriskProvider'));
  }

  async answerCall(_payload: any): Promise<CallAnsweredEvent> {
    return Promise.reject(new Error('Outbound answerCall not supported by AsteriskProvider'));
  }

  async hangupCall(_payload: any): Promise<CallEndedEvent> {
    return Promise.reject(new Error('Outbound hangupCall not supported by AsteriskProvider'));
  }
}
