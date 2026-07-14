import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { storage } from "@/services/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wb = await db.generatedWorkbook.findUnique({
    where: { id },
    include: { engagement: { include: { client: true } } },
  });
  if (!wb) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buf = await storage().get(wb.storageKey);
  const safeName = wb.engagement.client.businessName.replace(/[^a-zA-Z0-9]+/g, "_");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}_FY${wb.engagement.fiscalYear}_v${wb.version}.xlsx"`,
    },
  });
}
