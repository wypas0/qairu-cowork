import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Раздача .ics и вебхука должна работать на Node-рантайме: там есть crypto и pg-драйвер.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
