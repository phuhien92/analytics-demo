import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";

import {
  AnswerProvenanceSchema,
  AnswerSchema,
  MAX_LIMIT,
  ModelQuerySpecSchema,
  NarrationSchema,
  ProvenanceSchema,
  QuerySpecSchema,
  SpecPatchSchema,
  type Answer,
  type ModelQuerySpec,
  type QuerySpec,
} from "@/server/contracts";

/** The smallest spec that validates. Every case below perturbs one field of it. */
const validSpec: QuerySpec = {
  measure: "m_demo",
  filters: [],
  sort: { by: "measure", dir: "desc", tieBreak: "d_demo" },
  limit: 10,
  guards: [],
  asOf: null,
};

const validModelSpec: ModelQuerySpec = {
  measure: "m_demo",
  filters: [],
  sort: { by: "measure", dir: "desc" },
  limit: 10,
  guards: [],
};

const validProvenance = {
  requestId: "req_1",
  adapterId: "adapter_demo",
  sourceId: "source_demo",
  layerVersion: "0.0.0",
  layerSchemaVersion: 1,
  resolvedAsOf: "2018-09-26T00:00:00.000Z",
  engineVersion: "0.0.0",
  computedAt: "2026-09-18T00:00:00.000Z",
};

/**
 * Stubbed here, deliberately. GA-04 supplies the real one against the loaded layer;
 * what case 5 proves is that the model's surface plus a layer default composes into
 * something the executable schema accepts.
 */
function resolveSpec(
  modelSpec: ModelQuerySpec,
  layer: { defaultTieBreak: string },
  resolvedAsOf: string | null,
): unknown {
  return {
    ...modelSpec,
    sort: { ...modelSpec.sort, tieBreak: layer.defaultTieBreak },
    asOf: resolvedAsOf,
  };
}

describe("QuerySpec: the model cannot express a join", () => {
  // Case 1. Not "the field is ignored" — "the spec is rejected". Assert on the issue
  // code, because strictObject's unrecognized_keys issue carries `continue: true`, so a
  // test that only checked for an abort would pass for the wrong reason.
  it("rejects a spec carrying joins, join or sql", () => {
    for (const key of ["joins", "join", "sql"]) {
      const result = QuerySpecSchema.safeParse({ ...validSpec, [key]: ["anything"] });

      expect(result.success, key).toBe(false);
      expect(result.error?.issues.map((issue) => issue.code), key).toContain("unrecognized_keys");
    }
  });

  // Case 1b. The derived schema is the surface the model actually emits into, so it is
  // the one that most needs the guarantee. Whether .omit().extend() preserves the
  // never() catchall is an implementation detail of Zod that a minor release could
  // change — hence a test, not an assumption.
  it("rejects them on the derived model schema too", () => {
    for (const key of ["joins", "join", "sql"]) {
      const result = ModelQuerySpecSchema.safeParse({ ...validModelSpec, [key]: ["anything"] });

      expect(result.success, key).toBe(false);
      expect(result.error?.issues.map((issue) => issue.code), key).toContain("unrecognized_keys");
    }
  });
});

describe("QuerySpec: bounds and required fields", () => {
  // Case 2.
  it("bounds limit to 1..MAX_LIMIT", () => {
    for (const limit of [0, -1, MAX_LIMIT + 1]) {
      expect(QuerySpecSchema.safeParse({ ...validSpec, limit }).success).toBe(false);
    }
    for (const limit of [1, MAX_LIMIT]) {
      expect(QuerySpecSchema.safeParse({ ...validSpec, limit }).success).toBe(true);
    }
  });

  // Case 3. tieBreak is required on the executable spec and absent from the model's.
  it("requires sort.tieBreak on the spec and omits it from the model's", () => {
    const withoutTieBreak = {
      ...validSpec,
      sort: { by: "measure" as const, dir: "desc" as const },
    };

    expect(QuerySpecSchema.safeParse(withoutTieBreak).success).toBe(false);
    expect(ModelQuerySpecSchema.safeParse(validModelSpec).success).toBe(true);
  });

  // Case 4. asOf null means "latest"; a null resolvedAsOf is unconstructible.
  it("accepts a null asOf on the spec and rejects a null resolvedAsOf in provenance", () => {
    expect(QuerySpecSchema.safeParse({ ...validSpec, asOf: null }).success).toBe(true);
    expect(ProvenanceSchema.safeParse({ ...validProvenance, resolvedAsOf: null }).success).toBe(
      false,
    );
  });

  // Case 5.
  it("resolves a model spec into one QuerySpecSchema accepts", () => {
    const resolved = resolveSpec(validModelSpec, { defaultTieBreak: "d_demo" }, null);

    expect(QuerySpecSchema.parse(resolved).sort.tieBreak).toBe("d_demo");
  });

  // Case 8. Whoever reads this message is adding structure to fix a failing eval, so it
  // has to point at the offending path.
  it("points a validation error at the offending nested path", () => {
    const result = QuerySpecSchema.safeParse({
      ...validSpec,
      sort: { ...validSpec.sort, dir: "sideways" },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["sort", "dir"]);
  });
});

describe("SpecPatch: absent reAsOf is not null reAsOf", () => {
  // Case 6. Absent inherits the parent's snapshot; null re-resolves to latest. The
  // discriminator has to survive parsing, or "now just EU" silently time-travels.
  it("keeps the absent-versus-null discriminator through parsing", () => {
    const inherited = SpecPatchSchema.parse({ basedOn: "req_1" });
    const reResolved = SpecPatchSchema.parse({ basedOn: "req_1", reAsOf: null });

    expect("reAsOf" in inherited).toBe(false);
    expect("reAsOf" in reResolved).toBe(true);
    expect(reResolved.reAsOf).toBeNull();
  });
});

describe("Answer: the union forces both paths", () => {
  // Case 7. The `never` check is the assertion; it fails at compile time, under
  // `npx tsc --noEmit`, if a branch is ever added without a caller handling it.
  it("is exhaustive over ok", () => {
    function describeAnswer(answer: Answer): string {
      switch (answer.ok) {
        case true:
          return `rows: ${answer.resultSet.rows.length}`;
        case false:
          return `clarify: ${answer.rejection.asked}`;
        default: {
          const unreachable: never = answer;
          return unreachable;
        }
      }
    }

    const rejection = AnswerSchema.parse({
      ok: false,
      // Every answer states its provenance, refusal included: which moment, which layer
      // and which adapter refused is what makes a refusal reproducible (GA-07).
      provenance: {
        requestId: "req_1",
        adapterId: "local-store",
        layerVersion: "1.0.0",
        resolvedAsOf: "2018-09-26T00:00:00.000Z",
      },
      degraded: true,
      rejection: {
        kind: "clarify",
        asked: "which region?",
        missing: [{ what: "region", kind: "dimension" }],
        declared: { measures: ["m_demo"], dimensions: ["d_demo"] },
        nearest: [{ question: "a question that works", spec: validSpec }],
      },
    });

    expect(describeAnswer(rejection)).toBe("clarify: which region?");
  });

  // Case 7b. `AnswerProvenanceSchema` is derived with `.pick()` from `ProvenanceSchema`
  // rather than written out again — one artifact, two surfaces, as `ModelQuerySpecSchema`
  // already does with `.omit()`. Strictness has to survive that derivation, and the
  // failure mode if it does not is silence: an extra field would simply be accepted.
  // Asserted rather than assumed, for the same reason `.strict()` is banned outright.
  it("keeps the derived answer provenance strict", () => {
    expect(
      AnswerProvenanceSchema.safeParse({
        requestId: "req_1",
        adapterId: "adapter_demo",
        layerVersion: "0.0.0",
        resolvedAsOf: "2018-09-26T00:00:00.000Z",
        engineVersion: "1.0.0",
      }).success,
    ).toBe(false);
  });

  // Case 7c. The narration slot cannot hold prose. The single most expensive shortcut in
  // the plan (build-spec §5.1) is a `takeaway` string on the answer object, and strictness
  // is what makes adding one a test failure rather than a design decision nobody noticed.
  it("refuses a narration that carries text", () => {
    expect(
      NarrationSchema.safeParse({ producer: "template", locale: "en", takeaway: "…" }).success,
    ).toBe(false);
  });
});

describe("Structured outputs", () => {
  // Case 9. Catches at increment 1 any Zod construct that does not survive conversion
  // for structured outputs — notably z.record in GuardRefSchema.params — rather than at
  // GA-08, seven increments later.
  it("converts the model schema to a JSON Schema without throwing", () => {
    expect(() => zodOutputFormat(ModelQuerySpecSchema)).not.toThrow();
  });
});
