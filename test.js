import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const result = await prisma.calendarIntegration.findMany();
  console.log(result);
}
run().catch(console.error);
