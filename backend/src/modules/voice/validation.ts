import { z } from 'zod';

// Base fields common to all voice events
const baseSchema = z.object({
  provider: z.string(),
  providerCallId: z.string(),
  timestamp: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid timestamp' }),
  type: z.enum([
    'CALL_STARTED',
    'CALL_ANSWERED',
    'CALL_ENDED',
    'TRANSCRIPT_RECEIVED',
    'RECORDING_AVAILABLE',
    'CALL_TRANSFERRED',
  ]),
});

// Specific event schemas
const callStartedSchema = baseSchema.extend({
  type: z.literal('CALL_STARTED'),
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  from: z.string(),
  to: z.string(),
});

const callAnsweredSchema = baseSchema.extend({
  type: z.literal('CALL_ANSWERED'),
});

const callEndedSchema = baseSchema.extend({
  type: z.literal('CALL_ENDED'),
  durationSeconds: z.number().int().nonnegative().optional(),
});

const transcriptReceivedSchema = baseSchema.extend({
  type: z.literal('TRANSCRIPT_RECEIVED'),
  speaker: z.enum(['CUSTOMER', 'AI', 'AGENT']),
  text: z.string(),
});

const recordingAvailableSchema = baseSchema.extend({
  type: z.literal('RECORDING_AVAILABLE'),
  url: z.string().url(),
});

const callTransferredSchema = baseSchema.extend({
  type: z.literal('CALL_TRANSFERRED'),
  to: z.string(),
});

export const voiceWebhookSchema = z.union([
  callStartedSchema,
  callAnsweredSchema,
  callEndedSchema,
  transcriptReceivedSchema,
  recordingAvailableSchema,
  callTransferredSchema,
]);
