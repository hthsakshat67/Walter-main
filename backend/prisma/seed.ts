import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding demo database...');

  // Clean existing database records
  await prisma.auditLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.appointmentStatusHistory.deleteMany({});
  await prisma.appointment.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.phoneCall.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.service.deleteMany({});
  await prisma.availabilityRule.deleteMany({});
  await prisma.staff.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.business.deleteMany({});

  // 1. Create Business
  const business = await prisma.business.create({
    data: {
      name: 'Northside Wellness',
      slug: 'northside-wellness',
      assistantName: 'Walter',
      timezone: 'America/New_York',
      phone: '(312) 555-0100',
      email: 'contact@northsideclinic.com',
    },
  });

  // 2. Create User
  const passwordHash = await bcrypt.hash('password', 10);
  const user = await prisma.user.create({
    data: {
      businessId: business.id,
      email: 'owner@northsideclinic.com',
      passwordHash,
      name: 'Dr. Elena Ruiz',
      role: 'OWNER',
    },
  });

  // 3. Create Staff
  const staffRuiz = await prisma.staff.create({
    data: {
      businessId: business.id,
      userId: user.id,
      name: 'Dr. Elena Ruiz',
      email: 'elena@northsideclinic.com',
      phone: '(312) 555-0101',
      title: 'Medical Director',
    },
  });

  const staffPatel = await prisma.staff.create({
    data: {
      businessId: business.id,
      name: 'Dr. Noah Patel',
      email: 'noah@northsideclinic.com',
      phone: '(312) 555-0102',
      title: 'Associate Physician',
    },
  });

  const staffLewis = await prisma.staff.create({
    data: {
      businessId: business.id,
      name: 'Amara Lewis',
      email: 'amara@northsideclinic.com',
      phone: '(312) 555-0103',
      title: 'Lead Aesthetician',
    },
  });

  const staffBrooks = await prisma.staff.create({
    data: {
      businessId: business.id,
      name: 'Nina Brooks',
      email: 'nina@northsideclinic.com',
      phone: '(312) 555-0104',
      title: 'Patient Coordinator',
    },
  });

  // 4. Create Services
  const srvConsultation = await prisma.service.create({
    data: {
      businessId: business.id,
      name: 'New patient consultation',
      description: 'Comprehensive initial evaluation & treatment plan',
      durationMinutes: 45,
      bufferMinutes: 15,
      price: 150.0,
    },
  });

  const srvFollowup = await prisma.service.create({
    data: {
      businessId: business.id,
      name: 'Follow-up visit',
      description: 'Routine progress check-in',
      durationMinutes: 30,
      bufferMinutes: 15,
      price: 90.0,
    },
  });

  const srvColor = await prisma.service.create({
    data: {
      businessId: business.id,
      name: 'Color consultation',
      description: 'Personalized treatment consultation',
      durationMinutes: 60,
      bufferMinutes: 15,
      price: 180.0,
    },
  });

  const srvIntake = await prisma.service.create({
    data: {
      businessId: business.id,
      name: 'Initial intake',
      description: 'General health history intake',
      durationMinutes: 45,
      bufferMinutes: 15,
      price: 120.0,
    },
  });

  // 5. Create Availability Rules (Mon - Sat)
  for (let day = 1; day <= 6; day++) {
    await prisma.availabilityRule.create({
      data: {
        businessId: business.id,
        dayOfWeek: day,
        startTime: '08:00',
        endTime: '17:00',
      },
    });
  }

  // 6. Create Customers
  const custMaya = await prisma.customer.create({
    data: {
      businessId: business.id,
      name: 'Maya Thompson',
      email: 'maya@example.com',
      phone: '(312) 555-0189',
      segment: 'High value',
      notes: 'Next visit today',
    },
  });

  const custChris = await prisma.customer.create({
    data: {
      businessId: business.id,
      name: 'Chris Bennett',
      email: 'chris@example.com',
      phone: '(646) 555-0132',
      segment: 'Needs confirmation',
      notes: 'Pending reply',
    },
  });

  const custPriya = await prisma.customer.create({
    data: {
      businessId: business.id,
      name: 'Priya Shah',
      email: 'priya@example.com',
      phone: '(312) 555-0199',
      segment: 'High value',
      notes: 'Prefers morning appointments',
    },
  });

  const custJordan = await prisma.customer.create({
    data: {
      businessId: business.id,
      name: 'Jordan Lee',
      email: 'jordan@example.com',
      phone: '(312) 555-0177',
      segment: 'Standard',
    },
  });

  const custSofia = await prisma.customer.create({
    data: {
      businessId: business.id,
      name: 'Sofia Garcia',
      email: 'sofia@example.com',
      phone: '(415) 555-0194',
      segment: 'No-show risk',
      notes: 'Follow-up queued',
    },
  });

  const custMarcus = await prisma.customer.create({
    data: {
      businessId: business.id,
      name: 'Marcus Green',
      email: 'marcus@example.com',
      phone: '(617) 555-0148',
      segment: 'New lead',
      notes: 'Needs staff review',
    },
  });

  // 7. Create Appointments for Today
  const today = new Date();
  const makeTime = (hour: number, minute: number) => {
    const d = new Date(today);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  const appt1 = await prisma.appointment.create({
    data: {
      businessId: business.id,
      customerId: custMaya.id,
      serviceId: srvConsultation.id,
      staffId: staffRuiz.id,
      startTime: makeTime(8, 30),
      endTime: makeTime(9, 15),
      status: 'confirmed',
      channel: 'phone',
      notes: 'Confirmed by Walter by phone',
    },
  });

  const appt2 = await prisma.appointment.create({
    data: {
      businessId: business.id,
      customerId: custChris.id,
      serviceId: srvFollowup.id,
      staffId: staffPatel.id,
      startTime: makeTime(9, 30),
      endTime: makeTime(10, 0),
      status: 'pending',
      channel: 'WhatsApp',
      notes: 'Confirmation reminder sent via WhatsApp',
    },
  });

  const appt3 = await prisma.appointment.create({
    data: {
      businessId: business.id,
      customerId: custPriya.id,
      serviceId: srvColor.id,
      staffId: staffLewis.id,
      startTime: makeTime(11, 0),
      endTime: makeTime(12, 0),
      status: 'confirmed',
      channel: 'web',
      notes: 'Booked on web dashboard',
    },
  });

  const appt4 = await prisma.appointment.create({
    data: {
      businessId: business.id,
      customerId: custJordan.id,
      serviceId: srvFollowup.id,
      staffId: staffBrooks.id,
      startTime: makeTime(13, 15),
      endTime: makeTime(13, 45),
      status: 'completed',
      channel: 'email',
      notes: 'Check-in completed',
    },
  });

  const appt5 = await prisma.appointment.create({
    data: {
      businessId: business.id,
      customerId: custSofia.id,
      serviceId: srvIntake.id,
      staffId: staffRuiz.id,
      startTime: makeTime(15, 45),
      endTime: makeTime(16, 30),
      status: 'no-show risk',
      channel: 'phone',
      notes: 'Rescheduled by voice call',
    },
  });

  // Status history records
  await prisma.appointmentStatusHistory.createMany({
    data: [
      { appointmentId: appt1.id, newStatus: 'confirmed', changedBy: 'Walter', reason: 'Phone confirmation' },
      { appointmentId: appt2.id, newStatus: 'pending', changedBy: 'system', reason: 'Awaiting WhatsApp response' },
      { appointmentId: appt3.id, newStatus: 'confirmed', changedBy: 'system', reason: 'Web booking' },
      { appointmentId: appt4.id, newStatus: 'completed', changedBy: 'Dr. Elena Ruiz', reason: 'Visit completed' },
      { appointmentId: appt5.id, newStatus: 'no-show risk', changedBy: 'Walter', reason: 'Flagged for follow-up' },
    ],
  });

  // 8. Create Conversations
  const conv1 = await prisma.conversation.create({
    data: {
      businessId: business.id,
      customerId: custChris.id,
      channel: 'WhatsApp',
      intent: 'Confirm appointment',
      status: 'Awaiting customer',
      handler: 'Walter',
      result: 'Confirmation reminder sent',
    },
  });

  const conv2 = await prisma.conversation.create({
    data: {
      businessId: business.id,
      customerId: custSofia.id,
      channel: 'Phone',
      intent: 'Reschedule appointment',
      status: 'Resolved',
      handler: 'Walter',
      result: 'Successfully rescheduled',
    },
  });

  const conv3 = await prisma.conversation.create({
    data: {
      businessId: business.id,
      customerId: custMarcus.id,
      channel: 'Email',
      intent: 'Ask service price',
      status: 'Human review',
      handler: 'Front desk',
      result: 'Pricing question escalated',
    },
  });

  const conv4 = await prisma.conversation.create({
    data: {
      businessId: business.id,
      customerId: custPriya.id,
      channel: 'Web',
      intent: 'Book appointment',
      status: 'Resolved',
      handler: 'Walter',
      result: 'New booking created',
    },
  });

  // 9. Messages
  await prisma.message.createMany({
    data: [
      { conversationId: conv2.id, senderType: 'CUSTOMER', content: 'Can I move my 2:00 PM appointment to later today?' },
      { conversationId: conv2.id, senderType: 'AI', content: 'Of course! I have 3:45 PM available with Dr. Elena Ruiz. Would that work?' },
      { conversationId: conv2.id, senderType: 'CUSTOMER', content: 'Yes, 3:45 PM works great. Thank you!' },
      { conversationId: conv2.id, senderType: 'AI', content: 'Your appointment is now confirmed for today at 3:45 PM. See you soon!' },
    ],
  });

  // 10. Phone Calls
  await prisma.phoneCall.create({
    data: {
      businessId: business.id,
      conversationId: conv2.id,
      customerId: custSofia.id,
      direction: 'INBOUND',
      status: 'COMPLETED',
      duration: '02:43',
      durationSeconds: 163,
      transcript: 'Customer: Can I move my appointment? Walter: 3:45 PM is open. Customer: Perfect.',
      summary: 'Walter moved the appointment from 2:00 PM to 3:45 PM and sent confirmation by SMS.',
      intent: 'Reschedule appointment',
      appointmentAction: 'Successfully rescheduled',
      transferStatus: 'not needed',
    },
  });

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
