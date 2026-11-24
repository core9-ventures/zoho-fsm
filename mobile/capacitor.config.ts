import type { CapacitorConfig } from "@capacitor/cli";

// `pnpm apk` builds a debug APK with CAP_DEBUG=1: the app may then call a PC on the same Wi-Fi over plain http.
const debug = process.env.CAP_DEBUG === "1";

const config: CapacitorConfig = {
  appId: "ai.core9.fieldserve",
  appName: "FieldServe",
  webDir: "dist",
  android: { allowMixedContent: debug },
  server: { androidScheme: "https" },
};

export default config;
