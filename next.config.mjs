/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: [
      "@napi-rs/canvas",
      "pdfjs-dist",
      "pdf-parse",
    ],
    outputFileTracingIncludes: {
      "/api/ingest/email": [
        "./node_modules/@napi-rs/canvas/**/*",
        "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
        "./node_modules/@napi-rs/canvas-linux-x64-musl/**/*",
        "./node_modules/pdfjs-dist/**/*",
      ],
      "/api/inbox/classify": [
        "./node_modules/@napi-rs/canvas/**/*",
        "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
        "./node_modules/@napi-rs/canvas-linux-x64-musl/**/*",
        "./node_modules/pdfjs-dist/**/*",
      ],
    },
  },
};

export default nextConfig;
