import { google } from 'googleapis';
import { getOAuth2Client } from '../calendar/googleOAuth.js';

export class GmailService {
  /**
   * Send an email using the business's connected Gmail account.
   */
  static async sendEmail(businessId: string, to: string, subject: string, bodyText: string) {
    try {
      const auth = await getOAuth2Client(businessId);
      const gmail = google.gmail({ version: 'v1', auth });

      const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
      const messageParts = [
        `To: ${to}`,
        `Subject: ${utf8Subject}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        `MIME-Version: 1.0`,
        '',
        bodyText,
      ];
      const message = messageParts.join('\n');
      
      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      console.log(`[GmailService] Sent email to ${to}, Message ID: ${res.data.id}`);
      return res.data;
    } catch (error) {
      console.error('[GmailService] Error sending email:', error);
      throw new Error('Failed to send email via Gmail API.');
    }
  }

  /**
   * Sync incoming emails from the Gmail account and add them to Conversations.
   */
  static async syncIncomingEmails(businessId: string) {
    try {
      const auth = await getOAuth2Client(businessId);
      const gmail = google.gmail({ version: 'v1', auth });

      // Fetch recent messages
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread', // only unread
        maxResults: 20,
      });

      const messages = res.data.messages || [];
      const syncedIds = [];

      for (const msgInfo of messages) {
        if (!msgInfo.id) continue;
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: msgInfo.id,
          format: 'full',
        });
        const emailData = msgRes.data;
        const headers = emailData.payload?.headers || [];
        const fromHeader = headers.find((h) => h.name === 'From')?.value || '';
        const subject = headers.find((h) => h.name === 'Subject')?.value || 'No Subject';

        // Extract email address
        const emailMatch = fromHeader.match(/<(.+)>/);
        const senderEmail = emailMatch ? emailMatch[1] : fromHeader;

        // Extract body
        let body = '';
        if (emailData.payload?.parts) {
          const part = emailData.payload.parts.find((p) => p.mimeType === 'text/plain') || emailData.payload.parts[0];
          if (part && part.body && part.body.data) {
            body = Buffer.from(part.body.data, 'base64').toString('utf-8');
          }
        } else if (emailData.payload?.body?.data) {
          body = Buffer.from(emailData.payload.body.data, 'base64').toString('utf-8');
        }

        if (senderEmail && body) {
          // Process the incoming email (find customer, add conversation)
          // For simplicity, we just mark as read so we don't process again
          await gmail.users.messages.modify({
            userId: 'me',
            id: msgInfo.id,
            requestBody: {
              removeLabelIds: ['UNREAD'],
            },
          });
          syncedIds.push(msgInfo.id);
        }
      }

      return { syncedCount: syncedIds.length };
    } catch (error) {
      console.error('[GmailService] Error syncing emails:', error);
      throw new Error('Failed to sync emails.');
    }
  }
}
