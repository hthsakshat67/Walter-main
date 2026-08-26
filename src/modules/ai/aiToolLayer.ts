import { prisma } from '../../db/prisma.js';
import { AppointmentEngine } from '../appointments/appointmentEngine.js';
import { AvailabilityEngine } from '../availability/availabilityEngine.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface AIToolExecutionInput {
  businessId: string;
  toolName: string;
  arguments: Record<string, any>;
  performedBy?: string;
}

export class AIToolLayer {
  /**
   * Controlled execution entry point for LLM tool calls.
   * Enforces business rules and delegates all mutations directly to the backend AppointmentEngine.
   */
  static async executeTool(input: AIToolExecutionInput) {
    const { businessId, toolName, arguments: args, performedBy = 'Walter AI Agent' } = input;

    switch (toolName) {
      case 'checkAvailability': {
        if (!args.serviceId || !args.date) {
          throw new AppError('checkAvailability requires serviceId and date (YYYY-MM-DD)', 400);
        }
        const slots = await AvailabilityEngine.calculateAvailability({
          businessId,
          serviceId: args.serviceId,
          staffId: args.staffId,
          date: args.date,
        });
        return { success: true, tool: toolName, availableSlots: slots.filter((s) => s.available) };
      }

      case 'createAppointment': {
        if (!args.customerId || !args.serviceId || !args.startTime) {
          throw new AppError('createAppointment requires customerId, serviceId, and startTime', 400);
        }
        const appointment = await AppointmentEngine.bookAppointment({
          businessId,
          customerId: args.customerId,
          serviceId: args.serviceId,
          staffId: args.staffId,
          startTime: new Date(args.startTime),
          channel: args.channel || 'phone',
          notes: args.notes || 'Created via AI Agent',
          changedBy: performedBy,
        });
        return { success: true, tool: toolName, appointment };
      }

      case 'getAppointment': {
        if (!args.appointmentId) throw new AppError('getAppointment requires appointmentId', 400);
        const appointment = await prisma.appointment.findFirst({
          where: { id: args.appointmentId, businessId },
          include: { customer: true, service: true, staff: true, statusHistory: true },
        });
        if (!appointment) throw new AppError('Appointment not found', 404);
        return { success: true, tool: toolName, appointment };
      }

      case 'rescheduleAppointment': {
        if (!args.appointmentId || !args.newStartTime) {
          throw new AppError('rescheduleAppointment requires appointmentId and newStartTime', 400);
        }
        const updated = await AppointmentEngine.rescheduleAppointment({
          businessId,
          appointmentId: args.appointmentId,
          newStartTime: new Date(args.newStartTime),
          reason: args.reason || 'Rescheduled via AI call/message',
          changedBy: performedBy,
        });
        return { success: true, tool: toolName, appointment: updated };
      }

      case 'cancelAppointment': {
        if (!args.appointmentId) throw new AppError('cancelAppointment requires appointmentId', 400);
        const cancelled = await AppointmentEngine.cancelAppointment({
          businessId,
          appointmentId: args.appointmentId,
          reason: args.reason || 'Cancelled via AI Agent',
          changedBy: performedBy,
        });
        return { success: true, tool: toolName, appointment: cancelled };
      }

      case 'getCustomer': {
        if (!args.customerId && !args.email && !args.phone) {
          throw new AppError('getCustomer requires customerId, email, or phone', 400);
        }
        const whereClause: any = { businessId };
        if (args.customerId) whereClause.id = args.customerId;
        else if (args.email) whereClause.email = args.email;
        else if (args.phone) whereClause.phone = args.phone;

        const customer = await prisma.customer.findFirst({ where: whereClause });
        if (!customer) throw new AppError('Customer not found', 404);
        return { success: true, tool: toolName, customer };
      }

      case 'createCustomer': {
        if (!args.name) throw new AppError('createCustomer requires name', 400);
        const newCustomer = await prisma.customer.create({
          data: {
            businessId,
            name: args.name,
            email: args.email || null,
            phone: args.phone || null,
            segment: args.segment || 'New lead',
            notes: args.notes || null,
          },
        });
        return { success: true, tool: toolName, customer: newCustomer };
      }

      case 'updateCustomer': {
        if (!args.customerId) throw new AppError('updateCustomer requires customerId', 400);
        const updated = await prisma.customer.updateMany({
          where: { id: args.customerId, businessId },
          data: {
            ...(args.name && { name: args.name }),
            ...(args.email && { email: args.email }),
            ...(args.phone && { phone: args.phone }),
            ...(args.segment && { segment: args.segment }),
            ...(args.notes && { notes: args.notes }),
          },
        });
        return { success: true, tool: toolName, result: updated };
      }

      case 'sendConfirmation': {
        if (!args.appointmentId) throw new AppError('sendConfirmation requires appointmentId', 400);
        const appt = await prisma.appointment.findFirst({
          where: { id: args.appointmentId, businessId },
          include: { customer: true },
        });
        if (!appt) throw new AppError('Appointment not found', 404);

        const notification = await prisma.notification.create({
          data: {
            businessId,
            appointmentId: appt.id,
            channel: args.channel || 'WHATSAPP',
            recipient: appt.customer.phone || appt.customer.email || 'customer@example.com',
            template: 'CONFIRMATION_REMINDER',
            status: 'SENT',
            sentAt: new Date(),
          },
        });
        return { success: true, tool: toolName, notification };
      }

      case 'transferToHuman': {
        const conversationId = args.conversationId;
        if (conversationId) {
          await prisma.conversation.updateMany({
            where: { id: conversationId, businessId },
            data: {
              status: 'Human review',
              handler: 'Front desk',
              result: args.reason || 'Escalated to human staff',
            },
          });
        }
        return { success: true, tool: toolName, status: 'Transferred to human desk', reason: args.reason };
      }

      default:
        throw new AppError(`Unknown AI tool: ${toolName}`, 400);
    }
  }
}
