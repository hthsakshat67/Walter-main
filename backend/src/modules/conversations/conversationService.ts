import { prisma } from '../../db/prisma.js';

export class ConversationService {
  static async listConversations(businessId: string, channel?: string) {
    const where: any = { businessId };
    if (channel) {
      where.channel = { equals: channel, mode: 'insensitive' };
    }
    return prisma.conversation.findMany({
      where,
      include: {
        customer: true,
        messages: { orderBy: { timestamp: 'asc' } },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  static async getById(businessId: string, id: string) {
    return prisma.conversation.findFirst({
      where: { id, businessId },
      include: { customer: true, messages: { orderBy: { timestamp: 'asc' } }, phoneCalls: true },
    });
  }

  static async addMessage(businessId: string, conversationId: string, senderType: string, content: string, externalId?: string) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, businessId },
    });

    if (!conversation) throw new Error('Conversation not found');

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderType,
        content,
        externalId,
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    return message;
  }
}
