/* src/modules/voice/voiceEvents.ts */

import { BaseVoiceEvent, CallAnsweredEvent, CallEndedEvent, CallStartedEvent, CallTransferredEvent, RecordingAvailableEvent, TranscriptReceivedEvent } from './voiceProvider.js';

export type VoiceEvent =
  | CallStartedEvent
  | CallAnsweredEvent
  | CallEndedEvent
  | TranscriptReceivedEvent
  | RecordingAvailableEvent
  | CallTransferredEvent;

export { BaseVoiceEvent, CallStartedEvent, CallAnsweredEvent, CallEndedEvent, TranscriptReceivedEvent, RecordingAvailableEvent, CallTransferredEvent };
