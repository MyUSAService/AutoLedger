/**
 * Seed: firm, staff user, one sample client + FY2025 engagement.
 * Run: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const firm = await db.firm.upsert({
    where: { id: "firm-altemore" },
    create: { id: "firm-altemore", name: "Altemore" },
    update: {},
  });

  await db.user.upsert({
    where: { email: "staff@altemore.com" },
    create: { email: "staff@altemore.com", role: "STAFF", firmId: firm.id },
    update: {},
  });
  await db.user.upsert({
    where: { email: "admin@altemore.com" },
    create: { email: "admin@altemore.com", role: "ADMIN", firmId: firm.id },
    update: {},
  });

  const client = await db.client.upsert({
    where: { id: "client-demo" },
    create: {
      id: "client-demo",
      firmId: firm.id,
      businessName: "Bella Vita Imports LLC",
      entityType: "SINGLE_MEMBER_LLC",
      businessType: "e-commerce (Italian food products)",
      language: "it",
    },
    update: {},
  });

  await db.engagement.upsert({
    where: { clientId_fiscalYear: { clientId: client.id, fiscalYear: 2025 } },
    create: { clientId: client.id, fiscalYear: 2025 },
    update: {},
  });

  console.log("Seeded: firm, staff+admin users, demo client, FY2025 engagement");
}

main().finally(() => db.$disconnect());
