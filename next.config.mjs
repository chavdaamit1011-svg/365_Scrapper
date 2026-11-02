/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  serverExternalPackages: ['mongoose'],
  experimental: {
    cpus: 1,
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // PERMANENT WINDOWS ONEDRIVE LOCK FIX:
      // Disabling Webpack filesystem pack caching in dev stops Webpack from
      // creating and rapidly renaming temporary .pack.gz_ files on disk.
      // This completely eliminates OneDrive file-locking collisions,
      // PackFileCacheStrategy ENOENT crashes, and routes-manifest.json deletion.
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
