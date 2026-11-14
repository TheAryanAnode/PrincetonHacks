import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { identifyPlugin } from "./server/identify";
export default defineConfig(({ mode }) => {
  // Empty prefix loads non-VITE_ vars server-side only; the key never reaches the client bundle.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), identifyPlugin(env.GEMINI_API_KEY, env.GEMINI_MODEL || undefined)],
    server: { port: 5173, strictPort: true },
  };
});
