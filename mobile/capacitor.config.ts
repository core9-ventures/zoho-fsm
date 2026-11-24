import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ai.core9.fieldserve",
  appName: "FieldServe",
  webDir: "dist",
  android: { allowMixedContent: false },
  server: { androidScheme: "https" },
};

export default config;
