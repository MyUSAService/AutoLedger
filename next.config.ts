import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "exceljs"],
  // The generated Prisma client (.prisma/client) is read from disk at runtime
  // and is not picked up by output file tracing — include it explicitly or
  // serverless deploys fail with ENOENT.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.prisma/client/**/*", "./node_modules/@prisma/client/**/*"],
  },
};

export default nextConfig;
