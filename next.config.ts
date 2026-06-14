import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
  serverExternalPackages: ["ffmpeg-static"],
};

export default withNextIntl(nextConfig);
