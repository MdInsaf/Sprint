import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const apiProxyTarget = env.VITE_PROXY_API_TARGET || "http://127.0.0.1:8000";

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: {
        "/v1/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      target: "esnext",
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom", "react-router-dom"],
            query: ["@tanstack/react-query"],
            ui: ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-tooltip", "@radix-ui/react-popover"],
          },
        },
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
