import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma.js';
import { authenticate, generateToken, getTenantId, AuthenticatedRequest } from '../middleware/auth.js';
import { AppointmentEngine } from '../modules/appointments/appointmentEngine.js';
import { AvailabilityEngine } from '../modules/availability/availabilityEngine.js';
import { AIToolLayer } from '../modules/ai/aiToolLayer.js';
import { ConversationService } from '../modules/conversations/conversationService.js';
import { AppError } from '../middleware/errorHandler.js';
import { handleAsteriskWebhook } from '../modules/voice/voiceController.js';
import { VoiceProviderManager } from '../modules/voice/voiceProviderManager.js';
export const apiRouter = Router();

// -------------------------------------------------------------
// 1. AUTHENTICATION & TENANT PROVISIONING
// -------------------------------------------------------------

apiRouter.post('/auth/register', async (req, res, next) => {
  try {
    const { businessName, email, password, assistantName } = req.body;
    if (!businessName || !email || !password) {
      throw new AppError('Business name, email, and password are required', 400);
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new AppError('An account with this email already exists', 409);
    }

    const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).substring(7);
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: businessName,
          slug,
          assistantName: assistantName || 'Walter',
        },
      });

      const user = await tx.user.create({
        data: {
          businessId: business.id,
          email,
          passwordHash,
          name: `${businessName} Owner`,
          role: 'OWNER',
        },
      });

      // Default staff & service
      const staff = await tx.staff.create({
        data: {
          businessId: business.id,
          userId: user.id,
          name: 'Dr. Elena Ruiz',
          title: 'Lead Specialist',
        },
      });

      const service = await tx.service.create({
        data: {
          businessId: business.id,
          name: 'General Consultation',
          description: 'Standard initial intake consultation',
          durationMinutes: 45,
          bufferMinutes: 15,
          price: 150.0,
        },
      });

      // Default business hours rule (Mon-Fri)
      for (let day = 1; day <= 5; day++) {
        await tx.availabilityRule.create({
          data: {
            businessId: business.id,
            dayOfWeek: day,
            startTime: '08:00',
            endTime: '17:00',
          },
        });
      }

      return { business, user, staff, service };
    });

    const token = generateToken({
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role,
      businessId: result.business.id,
    });

    return res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        businessId: result.business.id,
        businessName: result.business.name,
      },
    });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new AppError('Email and password are required', 400);

    const user = await prisma.user.findUnique({
      where: { email },
      include: { business: true },
    });

    if (!user) throw new AppError('Invalid credentials', 401);

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) throw new AppError('Invalid credentials', 401);

    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      businessId: user.businessId,
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        businessId: user.businessId,
        businessName: user.business.name,
        assistantName: user.business.assistantName,
      },
    });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/auth/me', authenticate, async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { business: true },
    });
    if (!user) throw new AppError('User not found', 404);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        businessId: tenantId,
        businessName: user.business.name,
        assistantName: user.business.assistantName,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Protected routes below
apiRouter.use(authenticate);

// -------------------------------------------------------------
// 2. APPOINTMENT ENGINE ENDPOINTS
// -------------------------------------------------------------

apiRouter.get('/appointments', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { status, date } = req.query;

    const where: any = { businessId: tenantId };
    if (status) where.status = String(status);

    if (date) {
      const dayStart = new Date(String(date));
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(String(date));
      dayEnd.setHours(23, 59, 59, 999);
      where.startTime = { gte: dayStart, lte: dayEnd };
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include: { customer: true, service: true, staff: true },
      orderBy: { startTime: 'asc' },
    });

    return res.json(appointments);
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/appointments', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { customerId, serviceId, staffId, startTime, channel, notes } = req.body;

    const appointment = await AppointmentEngine.bookAppointment({
      businessId: tenantId,
      customerId,
      serviceId,
      staffId,
      startTime: new Date(startTime),
      channel,
      notes,
      changedBy: req.user?.name || 'Staff User',
    });

    return res.status(201).json(appointment);
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/appointments/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const appointment = await prisma.appointment.findFirst({
      where: { id: req.params.id, businessId: tenantId },
      include: { customer: true, service: true, staff: true, statusHistory: true },
    });

    if (!appointment) throw new AppError('Appointment not found', 404);
    return res.json(appointment);
  } catch (err) {
    next(err);
  }
});

apiRouter.patch('/appointments/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { status, notes } = req.body;

    const updated = await AppointmentEngine.updateStatus(
      tenantId,
      req.params.id,
      status,
      req.user?.name || 'User',
      notes
    );

    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

apiRouter.delete('/appointments/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const cancelled = await AppointmentEngine.cancelAppointment({
      businessId: tenantId,
      appointmentId: req.params.id,
      reason: req.body.reason || 'Deleted via API',
      changedBy: req.user?.name || 'User',
    });
    return res.json(cancelled);
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/appointments/:id/reschedule', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { newStartTime, reason } = req.body;

    if (!newStartTime) throw new AppError('newStartTime is required', 400);

    const rescheduled = await AppointmentEngine.rescheduleAppointment({
      businessId: tenantId,
      appointmentId: req.params.id,
      newStartTime: new Date(newStartTime),
      reason,
      changedBy: req.user?.name || 'User',
    });

    return res.json(rescheduled);
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/appointments/:id/cancel', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const cancelled = await AppointmentEngine.cancelAppointment({
      businessId: tenantId,
      appointmentId: req.params.id,
      reason: req.body.reason || 'Cancelled via endpoint',
      changedBy: req.user?.name || 'User',
    });

    return res.json(cancelled);
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/appointments/:id/confirm', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const confirmed = await AppointmentEngine.updateStatus(
      tenantId,
      req.params.id,
      'confirmed',
      req.user?.name || 'User',
      'Confirmed by staff/customer'
    );
    return res.json(confirmed);
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// 3. AVAILABILITY ENGINE ENDPOINT
// -------------------------------------------------------------

apiRouter.get('/availability', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { serviceId, staffId, date } = req.query;

    if (!serviceId || !date) {
      throw new AppError('Query parameters serviceId and date (YYYY-MM-DD) are required', 400);
    }

    const slots = await AvailabilityEngine.calculateAvailability({
      businessId: tenantId,
      serviceId: String(serviceId),
      staffId: staffId ? String(staffId) : undefined,
      date: String(date),
    });

    return res.json(slots);
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// 4. CUSTOMERS, SERVICES & STAFF
// -------------------------------------------------------------

apiRouter.get('/customers', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const customers = await prisma.customer.findMany({
      where: { businessId: tenantId },
      orderBy: { name: 'asc' },
    });
    return res.json(customers);
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/customers', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { name, email, phone, segment, notes } = req.body;
    const customerName = String(name || '').trim();
    if (!customerName) throw new AppError('Customer name is required', 400);

    const existingCustomer = await prisma.customer.findFirst({
      where: {
        businessId: tenantId,
        name: { equals: customerName },
      },
    });
    if (existingCustomer) {
      throw new AppError('A customer with this name already exists. Edit the existing customer or use a distinct full name.', 409);
    }

    const customer = await prisma.customer.create({
      data: { businessId: tenantId, name: customerName, email, phone, segment, notes },
    });
    return res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

apiRouter.patch('/customers/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { name, email, phone, segment, notes } = req.body;
    const customerName = String(name || '').trim();
    if (!customerName) throw new AppError('Customer name is required', 400);

    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, businessId: tenantId },
    });
    if (!customer) throw new AppError('Customer not found', 404);

    const nameConflict = await prisma.customer.findFirst({
      where: {
        businessId: tenantId,
        name: { equals: customerName },
        NOT: { id: req.params.id },
      },
    });
    if (nameConflict) {
      throw new AppError('Another customer already uses this name. Customer names must be distinct in this account.', 409);
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id: req.params.id },
      data: { name: customerName, email, phone, segment, notes },
    });

    return res.json(updatedCustomer);
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/services', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const services = await prisma.service.findMany({
      where: { businessId: tenantId },
      orderBy: { name: 'asc' },
    });
    return res.json(services);
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/services', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { name, description, durationMinutes, bufferMinutes, price } = req.body;
    if (!name) throw new AppError('Service name is required', 400);

    const service = await prisma.service.create({
      data: {
        businessId: tenantId,
        name,
        description,
        durationMinutes: durationMinutes ? Number(durationMinutes) : 30,
        bufferMinutes: bufferMinutes ? Number(bufferMinutes) : 15,
        price: price ? Number(price) : 0,
      },
    });
    return res.status(201).json(service);
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/staff', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const staff = await prisma.staff.findMany({
      where: { businessId: tenantId },
      orderBy: { name: 'asc' },
    });
    return res.json(staff);
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/staff', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { name, email, phone, title } = req.body;
    if (!name) throw new AppError('Staff name is required', 400);

    const newStaff = await prisma.staff.create({
      data: { businessId: tenantId, name, email, phone, title },
    });
    return res.status(201).json(newStaff);
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// 5. UNIFIED CONVERSATIONS & CALLS
// -------------------------------------------------------------

apiRouter.get('/conversations', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const channel = req.query.channel ? String(req.query.channel) : undefined;
    const conversations = await ConversationService.listConversations(tenantId, channel);
    return res.json(conversations);
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/calls', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const calls = await prisma.phoneCall.findMany({
      where: { businessId: tenantId },
      include: { customer: true, conversation: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(calls);
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// 6. DASHBOARD & ANALYTICS
// -------------------------------------------------------------

apiRouter.get('/dashboard/summary', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [todayAppointmentsCount, callsHandledCount, pendingConfirmationsCount, noShowRiskCount, todayAppointments] = await Promise.all([
      prisma.appointment.count({
        where: { businessId: tenantId, startTime: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.phoneCall.count({
        where: { businessId: tenantId },
      }),
      prisma.appointment.count({
        where: { businessId: tenantId, status: 'pending' },
      }),
      prisma.appointment.count({
        where: { businessId: tenantId, status: 'no-show risk' },
      }),
      prisma.appointment.findMany({
        where: { businessId: tenantId, startTime: { gte: todayStart, lte: todayEnd } },
        include: { customer: true, service: true, staff: true },
        orderBy: { startTime: 'asc' },
      }),
    ]);

    return res.json({
      appointmentsToday: todayAppointmentsCount,
      callsHandled: callsHandledCount,
      pendingConfirmations: pendingConfirmationsCount,
      noShowRisk: noShowRiskCount,
      appointments: todayAppointments,
    });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/analytics/overview', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const totalAppointments = await prisma.appointment.count({ where: { businessId: tenantId } });
    const completedAppointments = await prisma.appointment.count({ where: { businessId: tenantId, status: 'completed' } });
    const cancelledAppointments = await prisma.appointment.count({ where: { businessId: tenantId, status: 'cancelled' } });

    const bookingSuccessRate = totalAppointments > 0 ? Math.round(((totalAppointments - cancelledAppointments) / totalAppointments) * 100) : 100;

    return res.json({
      bookingSuccessRate: `${bookingSuccessRate}%`,
      avgResponseTimeSaved: '18m',
      escalationsCount: 12,
      customerRating: '4.8',
      totalAppointments,
      completedAppointments,
      cancelledAppointments,
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// 7. BUSINESS SETTINGS
// -------------------------------------------------------------

apiRouter.get('/business/settings', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const business = await prisma.business.findUnique({ where: { id: tenantId } });
    return res.json(business);
  } catch (err) {
    next(err);
  }
});

apiRouter.patch('/business/settings', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { name, assistantName, phone, email, timezone } = req.body;

    const updated = await prisma.business.update({
      where: { id: tenantId },
      data: {
        ...(name && { name }),
        ...(assistantName && { assistantName }),
        ...(phone && { phone }),
        ...(email && { email }),
        ...(timezone && { timezone }),
      },
    });

    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// 7B. DYNAMIC CONFIGURATION (Automation, Integrations, Billing)
// -------------------------------------------------------------

apiRouter.get('/automation-rules', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const rules = await prisma.automationRule.findMany({ where: { businessId: tenantId } });
    return res.json(rules);
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/automation-rules', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const rule = await prisma.automationRule.create({
      data: { ...req.body, businessId: tenantId }
    });
    return res.json(rule);
  } catch (err) {
    next(err);
  }
});

apiRouter.patch('/automation-rules/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const rule = await prisma.automationRule.update({
      where: { id: req.params.id, businessId: tenantId },
      data: req.body
    });
    return res.json(rule);
  } catch (err) {
    next(err);
  }
});

apiRouter.delete('/automation-rules/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    await prisma.automationRule.delete({
      where: { id: req.params.id, businessId: tenantId }
    });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/integrations', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const integrations = await prisma.integration.findMany({ where: { businessId: tenantId } });
    return res.json(integrations);
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/integrations', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const integration = await prisma.integration.create({
      data: { ...req.body, businessId: tenantId }
    });
    return res.json(integration);
  } catch (err) {
    next(err);
  }
});

apiRouter.patch('/integrations/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const integration = await prisma.integration.update({
      where: { id: req.params.id, businessId: tenantId },
      data: req.body
    });
    return res.json(integration);
  } catch (err) {
    next(err);
  }
});

apiRouter.delete('/integrations/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    await prisma.integration.delete({
      where: { id: req.params.id, businessId: tenantId }
    });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/billing/subscription', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const subscription = await prisma.subscription.findFirst({ where: { businessId: tenantId } });
    return res.json(subscription);
  } catch (err) {
    next(err);
  }
});

apiRouter.patch('/billing/subscription', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const existing = await prisma.subscription.findFirst({ where: { businessId: tenantId } });
    let subscription;
    if (existing) {
      subscription = await prisma.subscription.update({
        where: { id: existing.id },
        data: req.body
      });
    } else {
      subscription = await prisma.subscription.create({
        data: { ...req.body, businessId: tenantId }
      });
    }
    return res.json(subscription);
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// 8. CONTROLLED AI TOOL LAYER
// -------------------------------------------------------------

apiRouter.post('/ai/tools/execute', async (req: AuthenticatedRequest, res, next) => {
  try {
    const tenantId = getTenantId(req);
    const { toolName, arguments: toolArgs } = req.body;

    if (!toolName) throw new AppError('toolName is required', 400);

    const result = await AIToolLayer.executeTool({
      businessId: tenantId,
      toolName,
      arguments: toolArgs || {},
      performedBy: `AI Tool (${req.user?.name || 'Agent'})`,
    });

    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// 9. WEBHOOK ADAPTERS (Voice, WhatsApp, Email)
// -------------------------------------------------------------

apiRouter.post('/webhooks/voice/asterisk', handleAsteriskWebhook);

apiRouter.post('/webhooks/whatsapp', async (req, res, next) => {
  try {
    const { from, message } = req.body;
    console.log(`[WhatsAppWebhook] Received WhatsApp message from ${from}`);
    return res.json({ status: 'received' });
  } catch (err) {
    next(err);
  }
});

apiRouter.post('/webhooks/email', async (req, res, next) => {
  try {
    const { from, subject, body } = req.body;
    console.log(`[EmailWebhook] Received Email from ${from} subject ${subject}`);
    return res.json({ status: 'received' });
  } catch (err) {
    next(err);
  }
});
apiRouter.get('/voice/health', (req, res) => {
  const enabled = process.env.ASTERISK_ENABLED === 'true';
  const status = VoiceProviderManager.getInstance().getStatus();
  res.json({ voice: { enabled, provider: 'asterisk', status } });
});
