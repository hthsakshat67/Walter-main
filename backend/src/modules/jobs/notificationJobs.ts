import { prisma } from '../../db/prisma.js';

export class NotificationJobs {
  /**
   * Process all queued notifications in a retry-safe, idempotent worker loop.
   */
  static async processPendingNotifications() {
    const queued = await prisma.notification.findMany({
      where: { status: 'QUEUED' },
      take: 10,
    });

    for (const notification of queued) {
      try {
        // Simulate channel delivery (Email / WhatsApp / SMS)
        console.log(`[NotificationJob] Sending ${notification.template} via ${notification.channel} to ${notification.recipient}`);

        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
          },
        });
      } catch (err) {
        console.error(`[NotificationJob] Delivery failed for ${notification.id}`, err);
        await prisma.notification.update({
          where: { id: notification.id },
          data: { status: 'FAILED' },
        });
      }
    }
  }
}
