import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `next dev` otherwise appends a generated block to `AGENTS.md` on every start
   * (`node_modules/next/dist/server/lib/generate-agent-files.js`).
   *
   * That file is this project's agent contract — the invariants an agent must not break
   * and the decisions already settled. Everything in it was written deliberately and
   * landed with its rationale, so a tool appending to it makes a document whose authority
   * rests on being deliberate partly automatic, and makes `npm run dev` dirty a tracked
   * file every time it runs. The guidance the block carries is real; it belongs in
   * `docs/architecture.md` §10 beside the rest of the stack's version-specific facts,
   * where it is cited rather than regenerated.
   */
  agentRules: false,
};

export default nextConfig;
