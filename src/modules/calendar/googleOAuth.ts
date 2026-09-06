import { google } from 'googleapis';
import { prisma } from '../../db/prisma.js';
import { OAuth2Client } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * Returns an OAuth2 client for the given business.
 * If a valid access token exists, it will be used.
 * If the access token is expired, it will be refreshed using the stored refresh token.
 */
export async function getOAuth2Client(businessId: string): Promise<OAuth2Client> {
  const integration = await prisma.calendarIntegration.findUnique({
    where: { businessId },
  });
  if (!integration) {
    throw new Error('No calendar integration configured for this business');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth environment variables are not set');
  }

  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Set stored credentials if available
  if (integration.accessToken) {
    oAuth2Client.setCredentials({
      access_token: integration.accessToken,
      refresh_token: integration.refreshToken,
    });
  }

  // Persist refreshed tokens back to DB when they are refreshed automatically by googleapis
  oAuth2Client.on('tokens', async (tokens) => {
    const updates: any = {};
    if (tokens.access_token) updates.accessToken = tokens.access_token;
    if (tokens.refresh_token) updates.refreshToken = tokens.refresh_token;
    if (Object.keys(updates).length) {
      await prisma.calendarIntegration.update({
        where: { businessId },
        data: updates,
      });
    }
  });

  return oAuth2Client;
}

/**
 * Generates the URL a user should visit to grant permission for Google Calendar.
 */
export function generateAuthUrl(): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth environment variables are not set');
  }
  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

/**
 * Exchanges an auth code for tokens and stores them.
 */
export async function exchangeCodeForTokens(businessId: string, code: string): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth environment variables are not set');
  }
  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { tokens } = await oAuth2Client.getToken(code);
  await prisma.calendarIntegration.upsert({
    where: { businessId },
    create: {
      businessId,
      accessToken: tokens.access_token ?? undefined,
      refreshToken: tokens.refresh_token ?? undefined,
    },
    update: {
      accessToken: tokens.access_token ?? undefined,
      refreshToken: tokens.refresh_token ?? undefined,
    },
  });
}
