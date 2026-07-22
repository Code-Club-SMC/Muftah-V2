import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import tailwindcss from "@tailwindcss/vite";
const config = defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    devtools({
      // Enhanced logs are enabled by default
      // enhancedLogs: {
      //   enabled: true,
      // },
      // // Optional: Configure event bus for devtools communication
      // eventBusConfig: {
      //   debug: true, // This will show debug logs in your terminal
      //   enabled: true,
      // },
    }),
    tailwindcss(),
    tanstackStart(),
    nitro({
      preset: "node-server",
    }),
    viteReact(),
  ],
});

export default config;
