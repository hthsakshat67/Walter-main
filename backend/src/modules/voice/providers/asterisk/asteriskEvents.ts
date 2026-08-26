// src/modules/voice/providers/asterisk/asteriskEvents.ts

/**
 * TypeScript definitions for ARI events used by the Asterisk provider.
 * Only the fields required for mapping to the normalized VoiceEvent are included.
 */
export interface AsteriskChannel {
  id: string;
  name: string;
  // The Stasis application name the channel is attached to (if any)
  application?: string;
  // Caller ID information from Asterisk
  caller?: {
    number?: string;
    name?: string;
  };
  // Dialplan information (e.g., extension) if available
  dialplan?: { extension?: string };
}

export interface AsteriskEventBase {
  type: string;
  timestamp: string; // ISO 8601
  channel: AsteriskChannel;
}

// Stasis events are triggered when a channel enters or leaves a Stasis application
export interface StasisStartEvent extends AsteriskEventBase {
  type: 'StasisStart';
  // Unique identifier for the Stasis session (not needed for us)
}

export interface StasisEndEvent extends AsteriskEventBase {
  type: 'StasisEnd';
}

// Channel state change events include many states; we only need "Up" for answer detection
export interface ChannelStateChangeEvent extends AsteriskEventBase {
  type: 'ChannelStateChange';
  // State can be 'Up', 'Ringing', 'Down', etc.
  state: string;
}

// Channel lifecycle events
export interface ChannelCreatedEvent extends AsteriskEventBase {
  type: 'ChannelCreated';
}

export interface ChannelAnsweredEvent extends AsteriskEventBase {
  type: 'ChannelAnswered';
}

export interface ChannelDestroyedEvent extends AsteriskEventBase {
  type: 'ChannelDestroyed';
}

// Union of events we handle
export type AsteriskEvent =
  | StasisStartEvent
  | StasisEndEvent
  | ChannelStateChangeEvent
  | ChannelCreatedEvent
  | ChannelAnsweredEvent
  | ChannelDestroyedEvent;
