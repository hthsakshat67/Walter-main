import { PrismaClient, PhoneCall, Conversation, CallTranscript } from '@prisma/client';
import {
  VoiceEvent,
  CallStartedEvent,
  CallAnsweredEvent,
  CallEndedEvent,
  TranscriptReceivedEvent,
  RecordingAvailableEvent,
  CallTransferredEvent,
} from './voiceProvider.js';

const prisma = new PrismaClient();

export class VoiceService {
  static async handleEvent(event: VoiceEvent): Promise<void> {
    switch (event.type) {
      case 'CALL_STARTED':
        await this.handleCallStarted(event as CallStartedEvent);
        break;
      case 'CALL_ANSWERED':
        await this.handleCallAnswered(event as CallAnsweredEvent);
        break;
      case 'CALL_ENDED':
        await this.handleCallEnded(event as CallEndedEvent);
        break;
      case 'TRANSCRIPT_RECEIVED':
        await this.handleTranscript(event as TranscriptReceivedEvent);
        break;
      case 'RECORDING_AVAILABLE':
        await this.handleRecording(event as RecordingAvailableEvent);
        break;
      case 'CALL_TRANSFERRED':
        await this.handleCallTransferred(event as CallTransferredEvent);
        break;
      default:
        break;
    }
  }

  private static async handleCallStarted(event: CallStartedEvent): Promise<void> {
    const existing = await prisma.phoneCall.findFirst({
      where: { provider: event.provider, providerCallId: event.providerCallId, businessId: event.businessId },
    });
    if (!existing) {
      const conversation = await prisma.conversation.create({
        data: { businessId: event.businessId, channel: 'PHONE', status: 'Resolved' },
      });
      await prisma.phoneCall.create({
        data: {
          businessId: event.businessId,
          conversationId: conversation.id,
          direction: event.direction,
          provider: event.provider,
          providerCallId: event.providerCallId,
          status: 'IN_PROGRESS',
          startedAt: new Date(event.timestamp),
        },
      });
    }
  }

  private static async handleCallAnswered(event: CallAnsweredEvent): Promise<void> {
    await prisma.phoneCall.updateMany({
      where: { provider: event.provider, providerCallId: event.providerCallId, businessId: event.businessId },
      data: { status: 'IN_PROGRESS', answeredAt: new Date(event.timestamp) },
    });
  }

  private static async handleCallEnded(event: CallEndedEvent): Promise<void> {
    await prisma.phoneCall.updateMany({
      where: { provider: event.provider, providerCallId: event.providerCallId, businessId: event.businessId },
      data: { status: 'COMPLETED', durationSeconds: event.durationSeconds ?? 0, endedAt: new Date(event.timestamp) },
    });
  }

  private static async handleTranscript(event: TranscriptReceivedEvent): Promise<void> {
    const call = await prisma.phoneCall.findFirst({
      where: { provider: event.provider, providerCallId: event.providerCallId, businessId: event.businessId },
    });
    if (!call) return;
    await prisma.callTranscript.create({
      data: { phoneCallId: call.id, speaker: event.speaker, text: event.text },
    });
  }

  private static async handleRecording(event: RecordingAvailableEvent): Promise<void> {
    await prisma.phoneCall.updateMany({
      where: { provider: event.provider, providerCallId: event.providerCallId, businessId: event.businessId },
      data: { recordingUrl: event.url },
    });
  }

  private static async handleCallTransferred(event: CallTransferredEvent): Promise<void> {
    await prisma.phoneCall.updateMany({
      where: { provider: event.provider, providerCallId: event.providerCallId, businessId: event.businessId },
      data: { transferStatus: 'transferred' },
    });
  }
}
