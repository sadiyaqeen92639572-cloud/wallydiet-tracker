import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  output: 'export',
  basePath: '/wu-tang-name-generator',
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ['motion'],
};

export default nextConfig;
