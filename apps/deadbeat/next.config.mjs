/** @type {import('next').NextConfig} */
const nextConfig = {
  // The engine is consumed from TypeScript source (imports use a .js suffix).
  transpilePackages: ["@curseengine/engine"],
  // Turbopack does not alias ".js" to ".ts" here, so scripts use webpack (--webpack).
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};
export default nextConfig;
