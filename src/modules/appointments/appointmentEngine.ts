import { prisma } from '../../db/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface CreateAppointmentInput {
  businessId: string;
  customerId: string;
  serviceId: string;
  staffId?: string;
  startTime: Date;
  channel?: 'phone' | 'WhatsApp' | 'email' | 'web' | 'manual';
  notes?: string;
  changedBy?: string;
}

export interface RescheduleAppointmentInput {
  businessId: string;
  appointmentId: string;
  newStartTime: Date;
  reason?: string;
  changedBy?: string;
}

export interface CancelAppointmentInput {
  businessId: string;
  appointmentId: string;
  reason?: string;
  changedBy?: string;
}

export class AppointmentEngine {
  /**
   * Primary method for booking an appointment across all channels (phone, WhatsApp, email, web, staff).
   * Ensures double-booking prevention, availability validation, and atomic transaction updates.
   */
  static async bookAppointment(input: CreateAppointmentInput) {
    const { businessId, customerId, serviceId, staffId, startTime, channel = 'web', notes, changedBy = 'system' } = input;

    // Validate customer and service existence under this tenant
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, businessId },
    });
    if (!customer) throw new AppError('Customer not found for this business', 404);

    const service = await prisma.service.findFirst({
      where: { id: serviceId, businessId },
    });
    if (!service) throw new AppError('Service not found for this business', 404);
    if (!service.active) throw new AppError('Selected service is inactive', 400);

    // Calculate end time using service duration + buffer
    const durationMs = service.durationMinutes * 60 * 1000;
    const bufferMs = service.bufferMinutes * 60 * 1000;
    const endTime = new Date(startTime.getTime() + durationMs);

    // If staffId is specified, check staff existence & status
    let assignedStaffId = staffId;
    if (assignedStaffId) {
      const staff = await prisma.staff.findFirst({
        where: { id: assignedStaffId, businessId, active: true },
      });
      if (!staff) throw new AppError('Staff member not found or inactive', 404);
    } else {
      // Auto-assign available staff if none specified
      const availableStaff = await prisma.staff.findFirst({
        where: { businessId, active: true },
      });
      if (availableStaff) {
        assignedStaffId = availableStaff.id;
      }
    }

    // Double-booking check: Check overlapping appointments (including buffer window)
    const effectiveStartTime = new Date(startTime.getTime() - bufferMs);
    const effectiveEndTime = new Date(endTime.getTime() + bufferMs);

    const conflictWhere: any = {
      businessId,
      status: { notIn: ['cancelled'] },
      OR: [
        {
          startTime: { lt: effectiveEndTime },
          endTime: { gt: effectiveStartTime },
        },
      ],
    };

    if (assignedStaffId) {
      conflictWhere.staffId = assignedStaffId;
    }

    const existingConflict = await prisma.appointment.findFirst({
      where: conflictWhere,
    });

    if (existingConflict) {
      throw new AppError('Time slot unavailable: An existing appointment conflicts with this time range.', 409);
    }

    // Atomic transaction for appointment creation + status history + notification queueing
    const appointment = await prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          businessId,
          customerId,
          serviceId,
          staffId: assignedStaffId,
          startTime,
          endTime,
          status: 'confirmed',
          channel,
          notes,
        },
        include: {
          customer: true,
          service: true,
          staff: true,
        },
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: created.id,
          previousStatus: null,
          newStatus: 'confirmed',
          changedBy,
          reason: `Initial booking via ${channel}`,
        },
      });

      // Queue initial booking confirmation notification
      await tx.notification.create({
        data: {
          businessId,
          appointmentId: created.id,
          channel: channel === 'WhatsApp' ? 'WHATSAPP' : 'EMAIL',
          recipient: created.customer.email || created.customer.phone || 'customer@example.com',
          template: 'APPOINTMENT_CONFIRMATION',
          status: 'QUEUED',
          scheduledAt: new Date(),
        },
      });

      return created;
    });

    return appointment;
  }

  /**
   * Reschedules an existing appointment to a new start time after checking conflict rules.
   */
  static async rescheduleAppointment(input: RescheduleAppointmentInput) {
    const { businessId, appointmentId, newStartTime, reason, changedBy = 'system' } = input;

    const existing = await prisma.appointment.findFirst({
      where: { id: appointmentId, businessId },
      include: { service: true },
    });

    if (!existing) throw new AppError('Appointment not found', 404);
    if (existing.status === 'cancelled') throw new AppError('Cannot reschedule a cancelled appointment', 400);

    const durationMs = existing.service.durationMinutes * 60 * 1000;
    const bufferMs = existing.service.bufferMinutes * 60 * 1000;
    const newEndTime = new Date(newStartTime.getTime() + durationMs);

    // Conflict check for new slot
    const effectiveStartTime = new Date(newStartTime.getTime() - bufferMs);
    const effectiveEndTime = new Date(newEndTime.getTime() + bufferMs);

    const conflict = await prisma.appointment.findFirst({
      where: {
        businessId,
        id: { not: appointmentId },
        staffId: existing.staffId,
        status: { notIn: ['cancelled'] },
        startTime: { lt: effectiveEndTime },
        endTime: { gt: effectiveStartTime },
      },
    });

    if (conflict) {
      throw new AppError('Requested reschedule time slot conflicts with an existing appointment', 409);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          startTime: newStartTime,
          endTime: newEndTime,
          status: 'confirmed',
        },
        include: { customer: true, service: true, staff: true },
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: res.id,
          previousStatus: existing.status,
          newStatus: 'confirmed',
          changedBy,
          reason: reason || 'Rescheduled appointment',
        },
      });

      return res;
    });

    return updated;
  }

  /**
   * Cancels an appointment and records status history.
   */
  static async cancelAppointment(input: CancelAppointmentInput) {
    const { businessId, appointmentId, reason, changedBy = 'system' } = input;

    const existing = await prisma.appointment.findFirst({
      where: { id: appointmentId, businessId },
    });

    if (!existing) throw new AppError('Appointment not found', 404);
    if (existing.status === 'cancelled') throw new AppError('Appointment is already cancelled', 400);

    const cancelled = await prisma.$transaction(async (tx) => {
      const res = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: 'cancelled',
          cancellationReason: reason || 'Cancelled by user/customer',
        },
        include: { customer: true, service: true, staff: true },
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: res.id,
          previousStatus: existing.status,
          newStatus: 'cancelled',
          changedBy,
          reason: reason || 'Cancelled appointment',
        },
      });

      return res;
    });

    return cancelled;
  }

  /**
   * Updates status (e.g., 'completed', 'confirmed', 'no-show risk', 'no-show').
   */
  static async updateStatus(businessId: string, appointmentId: string, status: string, changedBy = 'system', reason?: string) {
    const existing = await prisma.appointment.findFirst({
      where: { id: appointmentId, businessId },
    });

    if (!existing) throw new AppError('Appointment not found', 404);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: { status },
        include: { customer: true, service: true, staff: true },
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: updated.id,
          previousStatus: existing.status,
          newStatus: status,
          changedBy,
          reason: reason || `Status changed to ${status}`,
        },
      });

      return updated;
    });
  }
}
