import { Request, Response, NextFunction } from 'express';
import { authenticate, getTenantId } from '../../middleware/auth';
import { VoiceService } from './voiceService.js';
import { voiceWebhookSchema } from './validation.js';

/**
 * Controller for handling Asterisk webhook events.
 * Expects JWT authentication and validates payload using Zod.
 */
export const handleAsteriskWebhook = [
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const secretHeader = req.headers['x-voice-webhook-secret'];
      const expectedSecret = process.env.VOICE_WEBHOOK_SECRET;
      let businessId: string | undefined;
      if (secretHeader) {
        if (!expectedSecret) {
          return res.status(500).json({ error: 'Server misconfiguration: VOICE_WEBHOOK_SECRET not set' });
        }
        if (secretHeader !== expectedSecret) {
          return res.status(403).json({ error: 'Invalid webhook secret' });
        }
        // trusted machine‑to‑machine call
        businessId = process.env.ASTERISK_BUSINESS_ID;
      } else {
        // fallback to JWT authentication (original behavior)
        businessId = getTenantId(req);
      }
      if (!businessId) {
        return res.status(400).json({ error: 'Missing business context' });
      }
      const parseResult = voiceWebhookSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid webhook payload', details: parseResult.error.format() });
      }
      const event = { ...parseResult.data, businessId };
      await VoiceService.handleEvent(event as any);
      res.json({ status: 'ok' });
    } catch (err) {
      next(err);
    }
  },
];
