import type { NextConfig } from "next";

const backendOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || 'http://localhost:3001';

const nextConfig: NextConfig = {
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
