/* src/modules/voice/voiceEvents.ts */

import { BaseVoiceEvent, CallAnsweredEvent, CallEndedEvent, CallStartedEvent, CallTransferredEvent, RecordingAvailableEvent, TranscriptReceivedEvent } from './voiceProvider';

export type VoiceEvent =
  | CallStartedEvent
  | CallAnsweredEvent
  | CallEndedEvent
  | TranscriptReceivedEvent
  | RecordingAvailableEvent
  | CallTransferredEvent;

export { BaseVoiceEvent, CallStartedEvent, CallAnsweredEvent, CallEndedEvent, TranscriptReceivedEvent, RecordingAvailableEvent, CallTransferredEvent };
