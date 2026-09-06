import { google } from 'googleapis';
import { getOAuth2Client } from './googleOAuth.js';
export interface CalendarEventPayload {
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  attendeeEmail?: string;
}

export interface CalendarProviderAdapter {
  providerName: 'GOOGLE' | 'OUTLOOK';
  syncEvent(businessId: string, event: CalendarEventPayload): Promise<{ externalId: string; status: string }>;
  cancelEvent(businessId: string, externalId: string): Promise<{ success: boolean }>;
}

export class GoogleCalendarAdapter implements CalendarProviderAdapter {
  providerName = 'GOOGLE' as const;

  async syncEvent(businessId: string, event: CalendarEventPayload) {
    const oAuth2Client = await getOAuth2Client(businessId);
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: event.title,
        description: event.description,
        start: { dateTime: event.startTime.toISOString() },
        end: { dateTime: event.endTime.toISOString() },
        attendees: event.attendeeEmail ? [{ email: event.attendeeEmail }] : [],
      },
    });
    return { externalId: res.data.id ?? '', status: res.data.status ?? 'unknown' };
  }

  async cancelEvent(businessId: string, externalId: string) {
    return { success: true };
  }
}

export class CalendarSyncEngine {
  private static googleAdapter = new GoogleCalendarAdapter();

  static async syncAppointmentToCalendar(businessId: string, appointment: any) {
    try {
      const payload: CalendarEventPayload = {
        title: `Appointment: ${appointment.service?.name || 'Service'} with ${appointment.customer?.name || 'Customer'}`,
        description: `Handled by AI Receptionist. Status: ${appointment.status}`,
        startTime: new Date(appointment.startTime),
        endTime: new Date(appointment.endTime),
        attendeeEmail: appointment.customer?.email,
      };
      return await this.googleAdapter.syncEvent(businessId, payload);
    } catch (err) {
      console.error('Failed to sync appointment to external calendar', err);
      return null;
    }
  }
}
