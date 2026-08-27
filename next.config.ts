import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Caddy is our only public reverse proxy and supplies the trusted host.
  // Without this, Next builds absolute redirects from Docker's HOSTNAME:PORT.
  experimental: { trustHostHeader: true } as NextConfig['experimental'],
  turbopack: {},
  output: 'standalone',
};

export default nextConfig;
