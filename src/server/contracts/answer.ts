import { z } from "zod";

import { RejectionSchema } from "./rejection";
import { ResultSetSchema } from "./result-set";

/**
 * What the ask route returns. The union is the point: every caller has to handle
 * rejection, because there is no shape that omits it.
 */
export const AnswerSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    requestId: z.string(),
    /** True when no model was available and the deterministic path answered. */
    degraded: z.boolean(),
    resultSet: ResultSetSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    requestId: z.string(),
    degraded: z.boolean(),
    rejection: RejectionSchema,
  }),
]);

export type Answer = z.infer<typeof AnswerSchema>;
