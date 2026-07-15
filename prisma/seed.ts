/**
 * Seed: firm, staff user, one sample client + FY2025 engagement.
 * Run: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/auth";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const firm = await db.firm.upsert({
    where: { id: "firm-altemore" },
    create: { id: "firm-altemore", name: "Altemore" },
    update: {},
  });

  // Initial password — set ONLY on first creation, never overwritten on
  // redeploys (the seed runs on every Netlify build). Change after first login.
  const initialPassword = hashPassword(process.env.SEED_STAFF_PASSWORD || "altemore-dev-2026");
  await db.user.upsert({
    where: { email: "staff@altemore.com" },
    create: { email: "staff@altemore.com", role: "STAFF", firmId: firm.id, passwordHash: initialPassword },
    update: {},
  });
  await db.user.upsert({
    where: { email: "admin@altemore.com" },
    create: { email: "admin@altemore.com", role: "ADMIN", firmId: firm.id, passwordHash: initialPassword },
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

  await db.user.upsert({
    where: { email: "cliente@bellavita.example" },
    create: { email: "cliente@bellavita.example", role: "CLIENT", firmId: firm.id, clientId: client.id },
    update: {},
  });

  console.log("Seeded: firm, staff+admin (staff@altemore.com / altemore-dev-2026), demo client user cliente@bellavita.example, FY2025 engagement");
}

main().finally(() => db.$disconnect());
