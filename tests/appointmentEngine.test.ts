import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { AppointmentEngine } from '../src/modules/appointments/appointmentEngine.js';
import { AvailabilityEngine } from '../src/modules/availability/availabilityEngine.js';
import { AIToolLayer } from '../src/modules/ai/aiToolLayer.js';
import bcrypt from 'bcryptjs';

describe('Appointment Engine & SaaS Core Tests', () => {
  let businessId: string;
  let customerId: string;
  let serviceId: string;
  let staffId: string;

  beforeAll(async () => {
    // Setup test tenant
    const biz = await prisma.business.create({
      data: {
        name: 'Test Clinic',
        slug: `test-clinic-${Date.now()}`,
        assistantName: 'Walter Test',
      },
    });
    businessId = biz.id;

    const passHash = await bcrypt.hash('password', 10);
    const user = await prisma.user.create({
      data: {
        businessId,
        email: `test-${Date.now()}@clinic.com`,
        passwordHash: passHash,
        name: 'Test Owner',
        role: 'OWNER',
      },
    });

    const staff = await prisma.staff.create({
      data: {
        businessId,
        userId: user.id,
        name: 'Dr. Test Staff',
      },
    });
    staffId = staff.id;

    const service = await prisma.service.create({
      data: {
        businessId,
        name: 'Consultation',
        durationMinutes: 30,
        bufferMinutes: 15,
        price: 100,
      },
    });
    serviceId = service.id;

    const cust = await prisma.customer.create({
      data: {
        businessId,
        name: 'John Doe',
        email: 'john@example.com',
        phone: '(555) 000-1111',
      },
    });
    customerId = cust.id;

    // Set business hours
    for (let day = 0; day <= 6; day++) {
      await prisma.availabilityRule.create({
        data: { businessId, dayOfWeek: day, startTime: '08:00', endTime: '17:00' },
      });
    }
  });

  afterAll(async () => {
    if (businessId) {
      await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('should successfully book an appointment within available business hours', async () => {
    const startTime = new Date();
    startTime.setDate(startTime.getDate() + 1);
    startTime.setHours(10, 0, 0, 0);

    const appt = await AppointmentEngine.bookAppointment({
      businessId,
      customerId,
      serviceId,
      staffId,
      startTime,
      channel: 'web',
      notes: 'Unit test booking',
    });

    expect(appt).toBeDefined();
    expect(appt.status).toBe('confirmed');
    expect(appt.businessId).toBe(businessId);

    // Check status history entry created
    const history = await prisma.appointmentStatusHistory.findMany({
      where: { appointmentId: appt.id },
    });
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].newStatus).toBe('confirmed');
  });

  it('should prevent double booking when an overlapping appointment exists', async () => {
    const startTime = new Date();
    startTime.setDate(startTime.getDate() + 2);
    startTime.setHours(14, 0, 0, 0);

    // Book first slot
    await AppointmentEngine.bookAppointment({
      businessId,
      customerId,
      serviceId,
      staffId,
      startTime,
    });

    // Attempt second booking at same time
    await expect(
      AppointmentEngine.bookAppointment({
        businessId,
        customerId,
        serviceId,
        staffId,
        startTime,
      })
    ).rejects.toThrow('Time slot unavailable');
  });

  it('should reschedule an appointment to a valid open slot', async () => {
    const startTime = new Date();
    startTime.setDate(startTime.getDate() + 3);
    startTime.setHours(9, 0, 0, 0);

    const appt = await AppointmentEngine.bookAppointment({
      businessId,
      customerId,
      serviceId,
      staffId,
      startTime,
    });

    const newStartTime = new Date(startTime);
    newStartTime.setHours(11, 0, 0, 0);

    const rescheduled = await AppointmentEngine.rescheduleAppointment({
      businessId,
      appointmentId: appt.id,
      newStartTime,
      reason: 'Customer requested later time',
    });

    expect(rescheduled.startTime.toISOString()).toBe(newStartTime.toISOString());
  });

  it('should calculate availability slots correctly', async () => {
    const dateStr = new Date(Date.now() + 86400000 * 4).toISOString().split('T')[0];

    const slots = await AvailabilityEngine.calculateAvailability({
      businessId,
      serviceId,
      staffId,
      date: dateStr,
    });

    expect(Array.isArray(slots)).toBe(true);
    expect(slots.length).toBeGreaterThan(0);
  });

  it('should execute AI tools safely through the AI tool layer', async () => {
    const dateStr = new Date(Date.now() + 86400000 * 5).toISOString().split('T')[0];

    const result = await AIToolLayer.executeTool({
      businessId,
      toolName: 'checkAvailability',
      arguments: { serviceId, date: dateStr },
    });

    expect(result.success).toBe(true);
    expect(result.availableSlots).toBeDefined();
  });
});
