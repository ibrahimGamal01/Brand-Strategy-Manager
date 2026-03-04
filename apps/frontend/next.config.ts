import type { NextConfig } from "next";
import path from "path";

const backendOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || 'http://localhost:3001';

const nextConfig: NextConfig = {
  // Ensure output tracing resolves correctly when building this app from monorepo root on Vercel.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendOrigin}/api/:path*`,
      },
      {
        source: '/storage/:path*',
        destination: `${backendOrigin}/storage/:path*`,
      },
    ];
  },
};

export default nextConfig;
