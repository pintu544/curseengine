/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone with a self-contained server.js for Azure App Service.
  output: "standalone",
  // The engine is consumed from TypeScript source (imports use a .js suffix).
  transpilePackages: ["@curseengine/engine", "@curseengine/kill-switch"],
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
