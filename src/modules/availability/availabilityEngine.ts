import { prisma } from '../../db/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface GetAvailabilityQuery {
  businessId: string;
  serviceId: string;
  staffId?: string;
  date: string; // YYYY-MM-DD
}

export interface TimeSlot {
  startTime: string; // ISO String
  endTime: string;   // ISO String
  formattedTime: string; // e.g. "8:30 AM"
  available: boolean;
  staffId?: string;
  reason?: string;
}

export class AvailabilityEngine {
  /**
   * Calculates available booking slots for a given service and date.
   */
  static async calculateAvailability(query: GetAvailabilityQuery): Promise<TimeSlot[]> {
    const { businessId, serviceId, staffId, date } = query;

    const service = await prisma.service.findFirst({
      where: { id: serviceId, businessId },
    });

    if (!service) throw new AppError('Service not found', 404);

    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) {
      throw new AppError('Invalid date format. Use YYYY-MM-DD', 400);
    }

    const dayOfWeek = targetDate.getDay(); // 0 = Sun, 1 = Mon...

    // 1. Fetch availability rules for this day of week
    const ruleWhere: any = { businessId, dayOfWeek, isBlocked: false };
    if (staffId) ruleWhere.staffId = staffId;

    let rules = await prisma.availabilityRule.findMany({
      where: ruleWhere,
    });

    // Fallback: If no staff-specific rule, check general business rules
    if (rules.length === 0) {
      rules = await prisma.availabilityRule.findMany({
        where: { businessId, dayOfWeek, staffId: null, isBlocked: false },
      });
    }

    // Default business hours (8:00 AM - 5:00 PM) if no rule explicitly configured
    let dayStartTime = '08:00';
    let dayEndTime = '17:00';

    if (rules.length > 0) {
      dayStartTime = rules[0].startTime;
      dayEndTime = rules[0].endTime;
    }

    // Parse start and end Date bounds for the day
    const [startHour, startMin] = dayStartTime.split(':').map(Number);
    const [endHour, endMin] = dayEndTime.split(':').map(Number);

    const dayStart = new Date(targetDate);
    dayStart.setHours(startHour, startMin, 0, 0);

    const dayEnd = new Date(targetDate);
    dayEnd.setHours(endHour, endMin, 0, 0);

    // 2. Fetch existing appointments for the day
    const dayStartISO = new Date(targetDate);
    dayStartISO.setHours(0, 0, 0, 0);

    const dayEndISO = new Date(targetDate);
    dayEndISO.setHours(23, 59, 59, 999);

    const existingAppointments = await prisma.appointment.findMany({
      where: {
        businessId,
        status: { notIn: ['cancelled'] },
        ...(staffId ? { staffId } : {}),
        startTime: { gte: dayStartISO, lte: dayEndISO },
      },
    });

    // 3. Generate candidate time slots spaced by 30 minutes
    const slots: TimeSlot[] = [];
    const durationMs = service.durationMinutes * 60 * 1000;
    const bufferMs = service.bufferMinutes * 60 * 1000;
    const intervalMs = 30 * 60 * 1000; // 30 min step

    let currentSlotStart = new Date(dayStart);

    while (currentSlotStart.getTime() + durationMs <= dayEnd.getTime()) {
      const currentSlotEnd = new Date(currentSlotStart.getTime() + durationMs);

      // Check conflict with existing appointments including buffer times
      const effectiveStart = new Date(currentSlotStart.getTime() - bufferMs);
      const effectiveEnd = new Date(currentSlotEnd.getTime() + bufferMs);

      const hasConflict = existingAppointments.some((appt) => {
        const apptStart = new Date(appt.startTime);
        const apptEnd = new Date(appt.endTime);
        return apptStart < effectiveEnd && apptEnd > effectiveStart;
      });

      const formattedTime = currentSlotStart.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      slots.push({
        startTime: currentSlotStart.toISOString(),
        endTime: currentSlotEnd.toISOString(),
        formattedTime,
        available: !hasConflict,
        staffId: staffId || undefined,
        reason: hasConflict ? 'Booked' : undefined,
      });

      currentSlotStart = new Date(currentSlotStart.getTime() + intervalMs);
    }

    return slots;
  }
}
