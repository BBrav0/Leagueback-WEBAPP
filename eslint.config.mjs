import nextVitals from "eslint-config-next";

const config = [
  ...nextVitals,
  {
    ignores: [
      ".claude/**",
      ".next/**",
      "node_modules/**",
      "out/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
];

export default config;
