import { PrismaClient, PhoneCall, Conversation, CallTranscript } from '@prisma/client';
import { vi, beforeEach, describe, test, expect } from 'vitest';
import {
  CallStartedEvent,
  CallAnsweredEvent,
  CallEndedEvent,
  TranscriptReceivedEvent,
  RecordingAvailableEvent,
  CallTransferredEvent,
} from '../../src/modules/voice/voiceProvider';
import { VoiceService } from "../../src/modules/voice/voiceService";
// Mock PrismaClient
vi.mock('@prisma/client', () => {
  const mockPrisma = {
    phoneCall: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    conversation: {
      create: vi.fn(),
    },
    callTranscript: {
      create: vi.fn(),
    },
  };
  return { PrismaClient: vi.fn(() => mockPrisma) };
});

const mockPrisma = new PrismaClient() as any;

beforeEach(() => {
  vi.clearAllMocks();
  // Ensure conversation.create returns an object with an id
  mockPrisma.conversation.create.mockResolvedValue({ id: 1 } as any);
});

describe('VoiceService.handleEvent', () => {
  const base = {
    provider: 'local',
    providerCallId: 'call-123',
    businessId: 'biz-1',
    timestamp: new Date().toISOString(),
  } as const;

  test('CALL_STARTED creates conversation and phone call when none exists', async () => {
    mockPrisma.phoneCall.findFirst.mockResolvedValue(null);
    const event: CallStartedEvent = {
      ...base,
      type: 'CALL_STARTED',
      direction: 'INBOUND',
      from: '+123456',
      to: '+654321',
    };
    await VoiceService.handleEvent(event);
    expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
      data: { businessId: base.businessId, channel: 'PHONE', status: 'Resolved' },
    });
    expect(mockPrisma.phoneCall.create).toHaveBeenCalled();
  });

  test('CALL_ANSWERED updates existing call status', async () => {
    const event: CallAnsweredEvent = { ...base, type: 'CALL_ANSWERED' };
    await VoiceService.handleEvent(event);
    expect(mockPrisma.phoneCall.updateMany).toHaveBeenCalledWith({
      where: { provider: base.provider, providerCallId: base.providerCallId, businessId: base.businessId },
      data: { status: 'IN_PROGRESS', answeredAt: expect.any(Date) },
    });
  });

  test('CALL_ENDED updates status and duration', async () => {
    const event: CallEndedEvent = { ...base, type: 'CALL_ENDED', durationSeconds: 120 };
    await VoiceService.handleEvent(event);
    expect(mockPrisma.phoneCall.updateMany).toHaveBeenCalledWith({
      where: { provider: base.provider, providerCallId: base.providerCallId, businessId: base.businessId },
      data: { status: 'COMPLETED', durationSeconds: 120, endedAt: expect.any(Date) },
    });
  });

  test('TRANSCRIPT_RECEIVED creates transcript linked to call', async () => {
    mockPrisma.phoneCall.findFirst.mockResolvedValue({ id: 42 } as PhoneCall);
    const event: TranscriptReceivedEvent = {
      ...base,
      type: 'TRANSCRIPT_RECEIVED',
      speaker: 'CUSTOMER',
      text: 'Hello',
    };
    await VoiceService.handleEvent(event);
    expect(mockPrisma.callTranscript.create).toHaveBeenCalledWith({
      data: { phoneCallId: 42, speaker: 'CUSTOMER', text: 'Hello' },
    });
  });

  test('RECORDING_AVAILABLE updates recordingUrl', async () => {
    const event: RecordingAvailableEvent = {
      ...base,
      type: 'RECORDING_AVAILABLE',
      url: 'https://example.com/rec.wav',
    };
    await VoiceService.handleEvent(event);
    expect(mockPrisma.phoneCall.updateMany).toHaveBeenCalledWith({
      where: { provider: base.provider, providerCallId: base.providerCallId, businessId: base.businessId },
      data: { recordingUrl: event.url },
    });
  });

  test('CALL_TRANSFERRED updates transfer status', async () => {
    const event: CallTransferredEvent = {
      ...base,
      type: 'CALL_TRANSFERRED',
      to: '+998877',
    };
    await VoiceService.handleEvent(event);
    expect(mockPrisma.phoneCall.updateMany).toHaveBeenCalledWith({
      where: { provider: base.provider, providerCallId: base.providerCallId, businessId: base.businessId },
      data: { transferStatus: 'transferred' },
    });
  });
});
