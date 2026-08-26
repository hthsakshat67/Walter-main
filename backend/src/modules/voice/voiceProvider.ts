export interface VoiceProvider {
  /**
   * Initialize a new call (e.g., when a phone rings).
   * Returns a normalized VoiceEvent to be processed.
   */
  startCall(payload: any): Promise<VoiceEvent>;

  /**
   * Called when a call is answered.
   */
  answerCall(payload: any): Promise<VoiceEvent>;

  /**
   * Called when a call ends.
   */
  hangupCall(payload: any): Promise<VoiceEvent>;

  /**
   * Optional: handle call transfer.
   */
  transferCall?(payload: any): Promise<VoiceEvent>;
}

// Normalized event union used throughout the system
export type VoiceEvent =
  | CallStartedEvent
  | CallAnsweredEvent
  | CallEndedEvent
  | TranscriptReceivedEvent
  | RecordingAvailableEvent
  | CallTransferredEvent;

export interface BaseVoiceEvent {
  provider: string; // e.g., 'asterisk', 'local'
  providerCallId: string; // unique identifier from the provider
  businessId: string; // tenant id resolved from JWT
  timestamp: string; // ISO string
}

export interface CallStartedEvent extends BaseVoiceEvent {
  type: 'CALL_STARTED';
  direction: 'INBOUND' | 'OUTBOUND';
  from: string;
  to: string;
}

export interface CallAnsweredEvent extends BaseVoiceEvent {
  type: 'CALL_ANSWERED';
}

export interface CallEndedEvent extends BaseVoiceEvent {
  type: 'CALL_ENDED';
  durationSeconds?: number;
}

export interface TranscriptReceivedEvent extends BaseVoiceEvent {
  type: 'TRANSCRIPT_RECEIVED';
  speaker: 'CUSTOMER' | 'AI' | 'AGENT';
  text: string;
}

export interface RecordingAvailableEvent extends BaseVoiceEvent {
  type: 'RECORDING_AVAILABLE';
  url: string;
}

export interface CallTransferredEvent extends BaseVoiceEvent {
  type: 'CALL_TRANSFERRED';
  to: string;
}
