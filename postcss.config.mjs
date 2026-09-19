/**
 * Tailwind v4's whole build is this one plugin — no `tailwind.config.js`, no
 * `postcss-import`, no `autoprefixer`. The theme is declared in CSS, in
 * `src/app/globals.css`, where `@theme` maps the design system's tokens onto
 * Tailwind's variable names (`docs/architecture.md` §10a).
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
