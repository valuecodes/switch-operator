import type { Config } from "prettier";

const config: Config = {
  trailingComma: "es5",
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
  // Third-party imports, then the apps' `~/` alias, then relative imports,
  // each group separated by a blank line.
  importOrder: ["<THIRD_PARTY_MODULES>", "", "^~/(.*)$", "", "^[./]"],
};

export default config;
