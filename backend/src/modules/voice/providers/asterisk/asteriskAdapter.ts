// src/modules/voice/providers/asterisk/asteriskAdapter.ts

import WebSocket from 'ws';
import { VoiceService } from '../../voiceService.js';
import { ProviderStatus } from './asteriskProvider.js';
import {
  StasisStartEvent,
  StasisEndEvent,
  ChannelStateChangeEvent,
  ChannelCreatedEvent,
  ChannelAnsweredEvent,
  ChannelDestroyedEvent,
  AsteriskEvent,
} from './asteriskEvents.js';
import { CallStartedEvent, CallAnsweredEvent, CallEndedEvent } from '../../voiceProvider.js';

/**
 * Adapter that connects to Asterisk ARI WebSocket, translates ARI events into the
 * normalized VoiceEvent format and forwards them to VoiceService.
 */
export class AsteriskAdapter {
  private ws?: WebSocket;
  private status: ProviderStatus = 'disabled';
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly host: string;
  private readonly port: string;
  private readonly app: string;
  private readonly user: string;
  private readonly pass: string;

  // Track lifecycle per channel to avoid duplicate events and compute duration
  private channelState: Map<
    string,
    { startedAt?: string; answeredAt?: string; endedAt?: string }
  > = new Map();

  constructor() {
    this.host = process.env.ASTERISK_HOST ?? '127.0.0.1';
    this.port = process.env.ASTERISK_PORT ?? '8088';
    this.app = process.env.ASTERISK_APP ?? 'walter';
    this.user = process.env.ASTERISK_USER ?? '';
    this.pass = process.env.ASTERISK_PASSWORD ?? '';
  }

  /** Establish the WebSocket connection and start listening. */
  async connect(): Promise<void> {
    this.status = 'connecting';
    const auth = Buffer.from(`${this.user}:${this.pass}`).toString('base64');
    const wsUrl = `ws://${this.host}:${this.port}/ari/events?api_key=${this.user}:${this.pass}&app=${this.app}`;
    this.ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Basic ${auth}` },
    });

    this.ws.on('open', () => {
      this.status = 'connected';
      console.log('[AsteriskAdapter] WebSocket connected');
      this.reconnectAttempts = 0; // reset backoff on success
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const raw: AsteriskEvent = JSON.parse(data.toString());
        this.handleEvent(raw);
      } catch (e) {
        console.error('[AsteriskAdapter] Failed to parse ARI message', e);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.warn(`[AsteriskAdapter] WebSocket closed ${code} ${reason}`);
      this.status = 'disconnected';
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[AsteriskAdapter] WebSocket error', err);
      this.status = 'error';
      // If error happens before 'open', ensure we attempt reconnect
      this.scheduleReconnect();
    });
  }

  /** Disconnect gracefully and cancel any pending reconnection attempts. */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.status = 'disabled';
    this.channelState.clear();
    this.reconnectAttempts = 0;
  }

  getStatus(): ProviderStatus {
    return this.status;
  }

  /** Schedule a reconnection with exponential backoff (max 30s). */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return; // already scheduled
    const backoff = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts += 1;
    console.log(`[AsteriskAdapter] Reconnecting in ${backoff} ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect().catch((e) => {
        console.error('[AsteriskAdapter] Reconnect failed', e);
        // Continue exponential backoff on failure
        this.scheduleReconnect();
      });
    }, backoff);
  }

  /** Translate ARI events to normalized VoiceEvents and forward to VoiceService. */
  private handleEvent(event: AsteriskEvent): void {
    const provider = 'asterisk';
const businessId = process.env.ASTERISK_BUSINESS_ID;
    if (!businessId) {
      console.error('[AsteriskAdapter] Missing ASTERISK_BUSINESS_ID – cannot emit VoiceEvent');
      return;
    }
    const channelId = event.channel.id;
    const timestamp = event.timestamp;

    // Ensure we're only handling events for our Stasis app
    if (event.channel.application && event.channel.application !== this.app) {
      return;
    }

    // Helper to get or create channel lifecycle record
    const state = this.channelState.get(channelId) ?? {};
    this.channelState.set(channelId, state);

    switch (event.type) {
      case 'StasisStart':
        if (!state.startedAt) {
          state.startedAt = timestamp;
          const started: CallStartedEvent = {
            type: 'CALL_STARTED',
            provider,
            providerCallId: channelId,
            businessId,
            timestamp,
            direction: 'INBOUND',
            from: event.channel.caller?.number ?? 'unknown',
            to: event.channel.dialplan?.extension ||
    event.channel.name?.split('/')[1]?.split('-')[0] || '',
          };
          VoiceService.handleEvent(started);
        }
        break;

      case 'ChannelStateChange':
        const csEvent = event as ChannelStateChangeEvent;
        if (csEvent.state === 'Up' && !state.answeredAt) {
          state.answeredAt = timestamp;
          const answered: CallAnsweredEvent = {
            type: 'CALL_ANSWERED',
            provider,
            providerCallId: channelId,
            businessId,
            timestamp,
          };
          VoiceService.handleEvent(answered);
        }
        break;

      case 'ChannelAnswered':
        if (!state.answeredAt) {
          state.answeredAt = timestamp;
          const answered: CallAnsweredEvent = {
            type: 'CALL_ANSWERED',
            provider,
            providerCallId: channelId,
            businessId,
            timestamp,
          };
          VoiceService.handleEvent(answered);
        }
        break;

      case 'StasisEnd':
      case 'ChannelDestroyed':
        if (!state.endedAt) {
          state.endedAt = timestamp;
          const startedAt = state.startedAt ? new Date(state.startedAt) : undefined;
          const endedAt = new Date(timestamp);
          const durationSeconds =
            startedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : undefined;
          const ended: CallEndedEvent = {
            type: 'CALL_ENDED',
            provider,
            providerCallId: channelId,
            businessId,
            timestamp,
            durationSeconds,
          };
          VoiceService.handleEvent(ended);
          // Cleanup after call is finished
          this.channelState.delete(channelId);
        }
        break;

      // ChannelCreated can be ignored for our mapping; we rely on StasisStart.
      default:
        break;
    }
  }
}
