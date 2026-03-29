import { baseConfig } from "@repo/eslint/base";
import { defineConfig } from "eslint/config";

export default defineConfig(baseConfig, { ignores: ["scripts/**"] });
