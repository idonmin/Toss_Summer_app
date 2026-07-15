import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "summer-vacation-diary",

  brand: {
    // Summer-sky blue to match the seasonal diary concept.
    primaryColor: "#4A9DF8"
  },

  permissions: [],
  webBundleDir: "dist"
});
