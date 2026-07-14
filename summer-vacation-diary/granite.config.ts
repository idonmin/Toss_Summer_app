import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "summer-vacation-diary",
  brand: {
    // Console registration must use the same Korean app name and appName above.
    displayName: "나의 여름방학일기",
    // Summer-sky blue to match the seasonal diary concept.
    primaryColor: "#4A9DF8",
    icon: "", // 화면에 노출될 앱의 아이콘 이미지 주소로 바꿔주세요.
  },
  web: {
    host: "localhost",
    port: 5173,
    commands: {
      dev: "vite dev",
      build: "vite build",
    },
  },
  permissions: [],
  outdir: "dist",
});
