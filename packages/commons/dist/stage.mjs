// dist/src/canonical.js
import { createHash } from "node:crypto";
var CANONICAL_MAX_NODES = 1e5;
var CANONICAL_MAX_BYTES = 2e6;
function canonicalize(value, budget = {}) {
  const maxNodes = budget.maxNodes ?? CANONICAL_MAX_NODES;
  const maxBytes = budget.maxBytes ?? CANONICAL_MAX_BYTES;
  const active = /* @__PURE__ */ new Set();
  let nodes = 0;
  let bytes = 0;
  const take = (text) => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > maxBytes)
      throw new RangeError(`JSON_BYTE_LIMIT: canonical JSON exceeds ${maxBytes} UTF-8 bytes`);
    return text;
  };
  const quote = (text) => {
    if (text.length > maxBytes)
      throw new RangeError("JSON_BYTE_LIMIT: string exceeds the JSON byte budget");
    return take(JSON.stringify(text));
  };
  const visit = (item, path, depth) => {
    if (++nodes > maxNodes || depth > 100)
      throw new TypeError(`JSON_LIMIT at ${path}`);
    if (item === null)
      return take("null");
    if (typeof item === "string") {
      if (!item.isWellFormed())
        throw new TypeError(`INVALID_UNICODE at ${path}`);
      return quote(item);
    }
    if (typeof item === "boolean")
      return take(item ? "true" : "false");
    if (typeof item === "number") {
      if (!Number.isFinite(item) || Object.is(item, -0))
        throw new TypeError(`INVALID_NUMBER at ${path}`);
      if (Number.isInteger(item) && !Number.isSafeInteger(item))
        throw new TypeError(`UNSAFE_INTEGER at ${path}`);
      return take(JSON.stringify(item));
    }
    if (typeof item !== "object")
      throw new TypeError(`NOT_JSON at ${path}`);
    if (active.has(item))
      throw new TypeError(`JSON_CYCLE at ${path}`);
    const proto = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && proto !== Object.prototype && proto !== null) {
      throw new TypeError(`NOT_PLAIN_OBJECT at ${path}`);
    }
    if (Array.isArray(item) && proto !== Array.prototype)
      throw new TypeError(`NOT_PLAIN_ARRAY at ${path}`);
    active.add(item);
    try {
      const keys = Reflect.ownKeys(item);
      if (keys.some((key) => typeof key !== "string"))
        throw new TypeError(`SYMBOL_KEY at ${path}`);
      if (Array.isArray(item)) {
        if (keys.length !== item.length + 1)
          throw new TypeError(`SPARSE_OR_EXTENDED_ARRAY at ${path}`);
        take("[]");
        const parts2 = [];
        for (let index = 0; index < item.length; index++) {
          if (index)
            take(",");
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new TypeError(`NON_DATA_PROPERTY at ${path}[${index}]`);
          }
          parts2.push(visit(descriptor.value, `${path}[${index}]`, depth + 1));
        }
        return `[${parts2.join(",")}]`;
      }
      take("{}");
      const parts = [];
      for (const key of keys.sort()) {
        if (parts.length)
          take(",");
        if (!key.isWellFormed())
          throw new TypeError(`INVALID_UNICODE_KEY at ${path}`);
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!("value" in descriptor) || !descriptor.enumerable)
          throw new TypeError(`NON_DATA_PROPERTY at ${path}.${key}`);
        const encodedKey = quote(key);
        take(":");
        parts.push(`${encodedKey}:${visit(descriptor.value, `${path}.${key}`, depth + 1)}`);
      }
      return `{${parts.join(",")}}`;
    } finally {
      active.delete(item);
    }
  };
  return visit(value, "$", 0);
}
function sha256(value) {
  return sha256Bytes(canonicalize(value));
}
function sha256Bytes(text) {
  if (typeof text !== "string" || !text.isWellFormed())
    throw new TypeError("Expected well-formed UTF-8 text");
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function timestamp(value, label = "timestamp") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new TypeError(`${label} must be an ISO UTC instant with seconds and optional three-digit milliseconds`);
  }
  const time = Date.parse(value);
  const expanded = value.length === 20 ? value.replace("Z", ".000Z") : value;
  if (!Number.isFinite(time) || new Date(time).toISOString() !== expanded)
    throw new TypeError(`${label} is not a valid calendar instant`);
  return time;
}

// dist/src/strict-json.js
var MAX_JSON_BYTES = CANONICAL_MAX_BYTES;
var MAX_JSON_DEPTH = 128;
var StrictJsonError = class extends SyntaxError {
  code;
  offset;
  constructor(code, offset, detail) {
    super(`${code}: ${detail} at character ${offset}`);
    this.name = "StrictJsonError";
    this.code = code;
    this.offset = offset;
  }
};
function decimalIdentity(token) {
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  const fraction = parts[3] ?? "";
  const digits = (parts[2] + fraction).replace(/^0+/, "");
  if (!digits)
    return "0";
  let end = digits.length;
  while (digits[end - 1] === "0")
    end--;
  const significant = digits.slice(0, end);
  const exponent = Number(parts[4] ?? "0");
  if (!Number.isSafeInteger(exponent))
    return null;
  const scale = exponent - fraction.length + digits.length - significant.length;
  if (!Number.isSafeInteger(scale))
    return null;
  return `${parts[1]}${significant}e${scale}`;
}
function requireRoundtrippableNumber(token, offset) {
  const number = Number(token);
  const canonical = Number.isFinite(number) && !Object.is(number, -0) ? JSON.stringify(number) : null;
  if (canonical === null || decimalIdentity(token) !== decimalIdentity(canonical)) {
    throw new StrictJsonError("NUMBER_NOT_ROUNDTRIPPABLE", offset, "Number must retain its exact decimal value through binary64 JSON serialization; non-finite values and negative zero are unsupported");
  }
  if (Number.isInteger(number) && !Number.isSafeInteger(number)) {
    throw new StrictJsonError("UNSAFE_INTEGER", offset, "Integer values must be within the inclusive safe range -9007199254740991 to 9007199254740991");
  }
}
function parseStrictJson(raw) {
  if (typeof raw !== "string")
    throw new StrictJsonError("INVALID_JSON", 0, "Expected raw JSON text");
  if (raw.length > MAX_JSON_BYTES || Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES) {
    throw new StrictJsonError("JSON_TOO_LARGE", 0, `Maximum input size is ${MAX_JSON_BYTES} UTF-8 bytes`);
  }
  let offset = 0;
  const fail = (detail) => {
    throw new StrictJsonError("INVALID_JSON", offset, detail);
  };
  const whitespace = () => {
    while (raw[offset] === " " || raw[offset] === "	" || raw[offset] === "\n" || raw[offset] === "\r")
      offset++;
  };
  const string = () => {
    if (raw[offset] !== '"')
      return fail("Expected a quoted string");
    const start = offset++;
    while (offset < raw.length) {
      const character = raw[offset++];
      if (character === "\\") {
        offset++;
        continue;
      }
      if (character === '"') {
        try {
          return JSON.parse(raw.slice(start, offset));
        } catch {
          return fail("Invalid JSON string");
        }
      }
    }
    return fail("Unterminated JSON string");
  };
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const value = (depth) => {
    whitespace();
    const first = raw[offset];
    if (first === "{" || first === "[") {
      if (depth >= MAX_JSON_DEPTH)
        throw new StrictJsonError("JSON_TOO_DEEP", offset, `Maximum nesting depth is ${MAX_JSON_DEPTH}`);
      offset++;
      whitespace();
      const object = first === "{";
      const end = object ? "}" : "]";
      const keys = /* @__PURE__ */ new Set();
      if (raw[offset] === end) {
        offset++;
        return;
      }
      for (; ; ) {
        if (object) {
          whitespace();
          const keyOffset = offset;
          const key = string();
          if (keys.has(key))
            throw new StrictJsonError("DUPLICATE_JSON_KEY", keyOffset, "Duplicate decoded object key");
          keys.add(key);
          whitespace();
          if (raw[offset++] !== ":")
            fail("Expected colon after object key");
        }
        value(depth + 1);
        whitespace();
        if (raw[offset] === end) {
          offset++;
          return;
        }
        if (raw[offset++] !== ",")
          fail("Expected comma or closing delimiter");
      }
    }
    if (first === '"') {
      string();
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (raw.startsWith(literal, offset)) {
        offset += literal.length;
        return;
      }
    }
    number.lastIndex = offset;
    const match = number.exec(raw);
    if (!match)
      fail("Expected a JSON value");
    const next = raw[number.lastIndex];
    if (next !== void 0 && next !== " " && next !== "	" && next !== "\n" && next !== "\r" && next !== "," && next !== "]" && next !== "}") {
      fail("Invalid character after JSON number");
    }
    requireRoundtrippableNumber(match[0], offset);
    offset = number.lastIndex;
  };
  value(0);
  whitespace();
  if (offset !== raw.length)
    fail("Trailing content");
  try {
    return JSON.parse(raw);
  } catch {
    return fail("Invalid JSON");
  }
}

// dist/src/evidence.js
var isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
var EVIDENCE_LIMITS = Object.freeze({ sources: 1e3, facts: 1e3, dependencies: 1e4 });
var EvidenceLimitError = class extends TypeError {
};
function requiredId(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > 256)
    throw new TypeError(`${label} must be a nonempty string of at most 256 characters without surrounding whitespace`);
}
function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new TypeError(`Unknown ${label} field: ${key}`);
}
function validateAdmissionExcluded(value) {
  if (!Array.isArray(value) || value.length === 0)
    throw new TypeError("fact.admissionExcluded must be a nonempty array");
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim())
      throw new TypeError("fact.admissionExcluded entries must be nonempty strings");
  }
}
function validateBundle(value, options) {
  canonicalize(value);
  if (!isRecord(value))
    throw new TypeError("Evidence must be an object");
  exactKeys(value, ["sources", "facts"], "evidence");
  if (!Array.isArray(value.sources) || !Array.isArray(value.facts))
    throw new TypeError("Evidence requires sources and facts arrays");
  if (value.sources.length > EVIDENCE_LIMITS.sources || value.facts.length > EVIDENCE_LIMITS.facts) {
    throw new EvidenceLimitError("Evidence supports at most 1000 sources and 1000 facts");
  }
  let dependencies = 0;
  for (const fact of value.facts)
    if (isRecord(fact) && Array.isArray(fact.dependsOn)) {
      dependencies += fact.dependsOn.length;
      if (dependencies > EVIDENCE_LIMITS.dependencies) {
        throw new EvidenceLimitError("Evidence supports at most 10000 total dependency references");
      }
    }
  for (const source of value.sources) {
    if (!isRecord(source))
      throw new TypeError("Each source must be an object");
    exactKeys(source, ["id", "uri", "content", "digest"], "source");
    requiredId(source.id, "source.id");
    if ("uri" in source && (typeof source.uri !== "string" || !source.uri.trim()))
      throw new TypeError("source.uri must be a nonempty string");
    if ("digest" in source && (typeof source.digest !== "string" || !/^[0-9a-f]{64}$/.test(source.digest)))
      throw new TypeError("source.digest must be a lowercase SHA-256 hex string");
  }
  for (const fact of value.facts) {
    if (!isRecord(fact))
      throw new TypeError("Each fact must be an object");
    const factKeys = options?.m1AdmitBoundary ? ["id", "sourceId", "value", "claimId", "unit", "observedAt", "expiresAt", "dependsOn", "admissionExcluded"] : ["id", "sourceId", "value", "claimId", "unit", "observedAt", "expiresAt", "dependsOn"];
    exactKeys(fact, factKeys, "fact");
    requiredId(fact.id, "fact.id");
    requiredId(fact.sourceId, "fact.sourceId");
    if (!Object.hasOwn(fact, "value"))
      throw new TypeError("fact.value is required");
    if ("claimId" in fact)
      requiredId(fact.claimId, "fact.claimId");
    if ("unit" in fact)
      requiredId(fact.unit, "fact.unit");
    if ("observedAt" in fact)
      timestamp(fact.observedAt, "fact.observedAt");
    if ("expiresAt" in fact)
      timestamp(fact.expiresAt, "fact.expiresAt");
    if ("observedAt" in fact && "expiresAt" in fact && timestamp(fact.expiresAt) <= timestamp(fact.observedAt)) {
      throw new TypeError("fact.expiresAt must follow fact.observedAt");
    }
    if ("dependsOn" in fact) {
      if (!Array.isArray(fact.dependsOn))
        throw new TypeError("fact.dependsOn must be an array");
      for (const id of fact.dependsOn)
        requiredId(id, "fact.dependsOn entry");
      if (new Set(fact.dependsOn).size !== fact.dependsOn.length)
        throw new TypeError("fact.dependsOn contains duplicate references");
    }
    if ("admissionExcluded" in fact) {
      if (!options?.m1AdmitBoundary)
        throw new TypeError("Unknown fact field: admissionExcluded");
      validateAdmissionExcluded(fact.admissionExcluded);
    }
  }
}
function inspectEvidence(bundle, asOf, options) {
  const now = timestamp(asOf, "asOf");
  const report = { asOf, valid: false, issues: [], facts: [], lineage: [], sources: [] };
  try {
    validateBundle(bundle, options);
  } catch (error) {
    report.issues.push({ code: error instanceof EvidenceLimitError ? "EVIDENCE_LIMIT" : "MALFORMED_EVIDENCE", severity: "ERROR", factIds: [], message: error instanceof Error ? error.message : "Malformed evidence" });
    return report;
  }
  const sources = /* @__PURE__ */ new Map();
  const facts = /* @__PURE__ */ new Map();
  const states = /* @__PURE__ */ new Map();
  const reasonSets = /* @__PURE__ */ new Map();
  const sourceFacts = /* @__PURE__ */ new Map();
  const invalidSources = /* @__PURE__ */ new Set();
  const rank = { AVAILABLE: 0, FUTURE: 1, EXPIRED: 2, MISSING: 3, CONFLICT: 4, INVALID: 5 };
  const mark = (id, status, reason) => {
    const state = states.get(id);
    if (!state)
      return false;
    const changed = rank[status] > rank[state.status];
    if (changed)
      state.status = status;
    reasonSets.get(id).add(reason);
    return changed;
  };
  const issue = (code, severity, factIds, message) => report.issues.push({ code, severity, factIds: [...factIds].sort(), message });
  for (const source of bundle.sources) {
    if (sources.has(source.id)) {
      invalidSources.add(source.id);
      issue("DUPLICATE_SOURCE_ID", "ERROR", [], `Duplicate source id: ${source.id}`);
    } else
      sources.set(source.id, source);
  }
  for (const fact of bundle.facts) {
    if (facts.has(fact.id)) {
      mark(fact.id, "INVALID", "DUPLICATE_FACT_ID");
      issue("DUPLICATE_FACT_ID", "ERROR", [fact.id], `Duplicate fact id: ${fact.id}`);
    } else {
      facts.set(fact.id, fact);
      states.set(fact.id, { id: fact.id, status: "AVAILABLE", reasons: [] });
      reasonSets.set(fact.id, /* @__PURE__ */ new Set());
      const ids = sourceFacts.get(fact.sourceId) ?? [];
      ids.push(fact.id);
      sourceFacts.set(fact.sourceId, ids);
    }
  }
  for (const source of sources.values()) {
    if (Object.hasOwn(source, "content")) {
      const computedDigest = sha256(source.content);
      const contentStatus = source.digest === void 0 ? "CONTENT_ONLY" : source.digest === computedDigest ? "DIGEST_VERIFIED" : "DIGEST_MISMATCH";
      report.sources.push({ id: source.id, contentStatus, computedDigest });
      if (contentStatus === "DIGEST_MISMATCH") {
        invalidSources.add(source.id);
        issue("SOURCE_DIGEST_MISMATCH", "ERROR", sourceFacts.get(source.id) ?? [], `Content digest mismatch: ${source.id}`);
      }
    } else
      report.sources.push({ id: source.id, contentStatus: "REFERENCE_ONLY" });
  }
  for (const fact of facts.values()) {
    if (fact.admissionExcluded?.length) {
      mark(fact.id, "MISSING", `ADMISSION_EXCLUDED:${fact.admissionExcluded.join(",")}`);
      issue("ADMISSION_EXCLUDED", "UNAVAILABLE", [fact.id], `Admission excluded: ${fact.id}`);
    }
  }
  for (const fact of facts.values()) {
    report.lineage.push({ factId: fact.id, sourceId: fact.sourceId, dependsOn: [...fact.dependsOn ?? []].sort() });
    if (!sources.has(fact.sourceId)) {
      mark(fact.id, "MISSING", "MISSING_SOURCE");
      issue("MISSING_SOURCE", "UNAVAILABLE", [fact.id], `Missing source: ${fact.sourceId}`);
    }
    if (invalidSources.has(fact.sourceId))
      mark(fact.id, "INVALID", "INVALID_SOURCE");
    if (fact.observedAt !== void 0 && timestamp(fact.observedAt) > now) {
      mark(fact.id, "FUTURE", "FUTURE_OBSERVATION");
      issue("FUTURE_OBSERVATION", "UNAVAILABLE", [fact.id], "Observation occurs after asOf");
    }
    if (fact.expiresAt !== void 0 && timestamp(fact.expiresAt) <= now) {
      mark(fact.id, "EXPIRED", "EXPIRED_EVIDENCE");
      issue("EXPIRED_EVIDENCE", "UNAVAILABLE", [fact.id], "Evidence expires at or before asOf");
    }
    for (const dependency of fact.dependsOn ?? [])
      if (!facts.has(dependency)) {
        mark(fact.id, "MISSING", `MISSING_DEPENDENCY:${dependency}`);
        issue("MISSING_DEPENDENCY", "UNAVAILABLE", [fact.id], `Missing dependency: ${dependency}`);
      }
  }
  const dependencies = /* @__PURE__ */ new Map();
  const dependents = /* @__PURE__ */ new Map();
  for (const id of facts.keys()) {
    dependencies.set(id, []);
    dependents.set(id, []);
  }
  for (const fact of facts.values())
    for (const dependency of fact.dependsOn ?? [])
      if (facts.has(dependency)) {
        dependencies.get(fact.id).push(dependency);
        dependents.get(dependency).push(fact.id);
      }
  const visited = /* @__PURE__ */ new Set();
  const finished = [];
  for (const id of facts.keys()) {
    if (visited.has(id))
      continue;
    visited.add(id);
    const stack = [{ id, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const edges = dependencies.get(frame.id);
      if (frame.next === edges.length) {
        finished.push(frame.id);
        stack.pop();
        continue;
      }
      const child = edges[frame.next++];
      if (!visited.has(child)) {
        visited.add(child);
        stack.push({ id: child, next: 0 });
      }
    }
  }
  visited.clear();
  for (let index = finished.length - 1; index >= 0; index--) {
    const id = finished[index];
    if (visited.has(id))
      continue;
    visited.add(id);
    const members = [];
    const stack = [id];
    while (stack.length) {
      const member = stack.pop();
      members.push(member);
      for (const parent of dependents.get(member))
        if (!visited.has(parent)) {
          visited.add(parent);
          stack.push(parent);
        }
    }
    if (members.length > 1 || dependencies.get(id).includes(id)) {
      issue("DEPENDENCY_CYCLE", "ERROR", members, "Evidence dependencies contain a cycle");
      for (const member of members)
        mark(member, "INVALID", "DEPENDENCY_CYCLE");
    }
  }
  const claims = /* @__PURE__ */ new Map();
  for (const fact of facts.values())
    if (fact.claimId && states.get(fact.id).status === "AVAILABLE") {
      const group = claims.get(fact.claimId) ?? [];
      group.push(fact);
      claims.set(fact.claimId, group);
    }
  for (const [claimId, group] of claims) {
    const values = new Set(group.map((fact) => canonicalize({ value: fact.value, unit: fact.unit ?? null })));
    if (values.size > 1) {
      const ids = group.map((fact) => fact.id);
      issue("CONFLICTING_CLAIM", "UNAVAILABLE", ids, `Conflicting declared values or units for claim: ${claimId}`);
      for (const id of ids)
        mark(id, "CONFLICT", "CONFLICTING_CLAIM");
    }
  }
  const pending = [...states.values()].filter((state) => state.status !== "AVAILABLE").map((state) => state.id);
  const queued = new Set(pending);
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const dependency = pending[cursor];
    queued.delete(dependency);
    const status = states.get(dependency).status;
    for (const dependent of dependents.get(dependency)) {
      if (mark(dependent, status, `DEPENDENCY_UNAVAILABLE:${dependency}`) && !queued.has(dependent)) {
        pending.push(dependent);
        queued.add(dependent);
      }
    }
  }
  report.valid = !report.issues.some((item) => item.severity === "ERROR");
  report.facts = [...states.values()].map((state) => ({ ...state, reasons: [...reasonSets.get(state.id)].sort() })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  report.lineage.sort((a, b) => a.factId < b.factId ? -1 : a.factId > b.factId ? 1 : 0);
  report.sources.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return report;
}

// dist/src/m1/errors.js
var M1InvalidInputError = class extends Error {
  code;
  path;
  constructor(code, path, message) {
    super(message);
    this.name = "M1InvalidInputError";
    this.code = code;
    this.path = path;
  }
};
function invalidInput(code, path, message) {
  throw new M1InvalidInputError(code, path, message);
}
function exposeInvalidInput(error) {
  if (error instanceof M1InvalidInputError)
    return { code: error.code, path: error.path, message: error.message };
  if (error instanceof TypeError)
    return { code: "INVALID_INPUT", path: "", message: error.message };
  return { code: "INVALID_INPUT", path: "", message: error instanceof Error ? error.message : String(error) };
}

// dist/src/m1/validate.js
var SNAPSHOT_KEYS = ["schemaVersion", "asOf", "items", "sources", "evidence"];
var ITEM_KEYS = ["id", "priority", "owner", "dependsOn"];
var EVIDENCE_KEYS = ["id", "itemId", "subjectId", "field", "issuer", "sourceId", "observedAt", "expiresAt", "value", "dependsOn"];
var FIELD_KEYS = ["name", "type", "issuerAuthorities", "required", "eligibility", "disqualifier", "owner", "unit"];
var POLICY_KEYS = ["schemaVersion", "id", "version", "priorityOrder"];
var SOURCE_KEYS = ["id", "uri", "content", "digest"];
var M1_ITEM_LIMIT = 2e4;
var M1_RECEIPT_ITEM_LIMIT = 1024;
var M1_RECEIPT_TRACE_LIMIT = 512;
var M1_RECEIPT_CANONICAL_BUDGET = { maxNodes: 1e6, maxBytes: 24e6 };
function isRecord2(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function requireUtcMillisForm(value, path) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    invalidInput("INVALID_TIMESTAMP", path, "Timestamp must be YYYY-MM-DDTHH:mm:ss.sssZ");
  }
  timestamp(value, path);
}
function sortUniqueStrings(values, path) {
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length)
    invalidInput("DUPLICATE_REFERENCE", path, "Duplicate entries in sorted list");
  return sorted;
}
function validateSource(source, path) {
  if (!isRecord2(source))
    invalidInput("INVALID_INPUT", path, "Source must be an object");
  exactKeys(source, SOURCE_KEYS, "source");
  requiredId(source.id, `${path}.id`);
  const out = { id: source.id };
  if ("uri" in source) {
    if (typeof source.uri !== "string" || !source.uri.trim())
      invalidInput("INVALID_INPUT", `${path}.uri`, "uri must be nonempty");
    out.uri = source.uri;
  }
  if ("content" in source)
    out.content = source.content;
  if ("digest" in source) {
    if (typeof source.digest !== "string" || !/^[0-9a-f]{64}$/.test(source.digest)) {
      invalidInput("INVALID_INPUT", `${path}.digest`, "digest must be lowercase sha256 hex");
    }
    out.digest = source.digest;
  }
  return out;
}
function parseSnapshot(raw) {
  const value = parseStrictJson(raw);
  if (!isRecord2(value))
    invalidInput("INVALID_INPUT", "snapshot", "Snapshot must be an object");
  exactKeys(value, SNAPSHOT_KEYS, "snapshot");
  if (value.schemaVersion !== "commons.evidence-snapshot.v1")
    invalidInput("INVALID_INPUT", "snapshot.schemaVersion", "Unsupported snapshot schemaVersion");
  if (typeof value.asOf !== "string")
    invalidInput("INVALID_INPUT", "snapshot.asOf", "asOf must be a string");
  requireUtcMillisForm(value.asOf, "snapshot.asOf");
  if (!Array.isArray(value.items) || !Array.isArray(value.sources) || !Array.isArray(value.evidence)) {
    invalidInput("INVALID_INPUT", "snapshot", "items, sources and evidence must be arrays");
  }
  const items = value.items.map((item, index) => {
    if (!isRecord2(item))
      invalidInput("INVALID_INPUT", `snapshot.items[${index}]`, "Item must be an object");
    exactKeys(item, ITEM_KEYS, "item");
    requiredId(item.id, "item.id");
    requiredId(item.owner, "item.owner");
    if (typeof item.priority !== "number" || !Number.isSafeInteger(item.priority)) {
      invalidInput("INVALID_INPUT", `snapshot.items[${index}].priority`, "priority must be a safe integer");
    }
    if (!Array.isArray(item.dependsOn))
      invalidInput("INVALID_INPUT", `snapshot.items[${index}].dependsOn`, "dependsOn must be an array");
    for (const dep of item.dependsOn)
      requiredId(dep, "item.dependsOn entry");
    return {
      id: item.id,
      priority: item.priority,
      owner: item.owner,
      dependsOn: sortUniqueStrings(item.dependsOn, `snapshot.items[${index}].dependsOn`)
    };
  });
  const itemIds = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (itemIds.has(item.id))
      invalidInput("DUPLICATE_ID", "snapshot.items", `Duplicate item id: ${item.id}`);
    itemIds.add(item.id);
  }
  if (items.length > M1_ITEM_LIMIT) {
    invalidInput("JSON_LIMIT", "snapshot.items", `At most ${M1_ITEM_LIMIT} items in M1`);
  }
  const sources = value.sources.map((source, index) => validateSource(source, `snapshot.sources[${index}]`));
  const sourceIds = /* @__PURE__ */ new Set();
  for (const source of sources) {
    if (sourceIds.has(source.id))
      invalidInput("DUPLICATE_ID", "snapshot.sources", `Duplicate source id: ${source.id}`);
    sourceIds.add(source.id);
  }
  sources.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const evidenceIds = /* @__PURE__ */ new Set();
  const evidence = value.evidence.map((row, index) => {
    if (!isRecord2(row))
      invalidInput("INVALID_INPUT", `snapshot.evidence[${index}]`, "Evidence must be an object");
    exactKeys(row, EVIDENCE_KEYS, "evidence");
    requiredId(row.id, "evidence.id");
    if (evidenceIds.has(row.id))
      invalidInput("DUPLICATE_ID", "snapshot.evidence", `Duplicate evidence id: ${row.id}`);
    evidenceIds.add(row.id);
    requiredId(row.itemId, "evidence.itemId");
    requiredId(row.subjectId, "evidence.subjectId");
    requiredId(row.field, "evidence.field");
    requiredId(row.issuer, "evidence.issuer");
    requiredId(row.sourceId, "evidence.sourceId");
    if (!itemIds.has(row.itemId))
      invalidInput("INVALID_INPUT", `snapshot.evidence[${index}].itemId`, "Unknown itemId");
    if (!sourceIds.has(row.sourceId))
      invalidInput("INVALID_INPUT", `snapshot.evidence[${index}].sourceId`, "Unknown sourceId");
    requireUtcMillisForm(String(row.observedAt), `snapshot.evidence[${index}].observedAt`);
    requireUtcMillisForm(String(row.expiresAt), `snapshot.evidence[${index}].expiresAt`);
    if (timestamp(row.expiresAt) <= timestamp(row.observedAt)) {
      invalidInput("INVALID_RANGE", `snapshot.evidence[${index}]`, "expiresAt must follow observedAt");
    }
    if (!Array.isArray(row.dependsOn))
      invalidInput("INVALID_INPUT", `snapshot.evidence[${index}].dependsOn`, "dependsOn must be an array");
    for (const dep of row.dependsOn)
      requiredId(dep, "evidence.dependsOn entry");
    if (!Object.hasOwn(row, "value"))
      invalidInput("INVALID_INPUT", `snapshot.evidence[${index}].value`, "value is required");
    return {
      id: row.id,
      itemId: row.itemId,
      subjectId: row.subjectId,
      field: row.field,
      issuer: row.issuer,
      sourceId: row.sourceId,
      observedAt: String(row.observedAt),
      expiresAt: String(row.expiresAt),
      value: row.value,
      dependsOn: sortUniqueStrings(row.dependsOn, `snapshot.evidence[${index}].dependsOn`)
    };
  });
  evidence.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (sources.length > EVIDENCE_LIMITS.sources) {
    invalidInput("EVIDENCE_LIMIT", "snapshot.sources", `At most ${EVIDENCE_LIMITS.sources} sources`);
  }
  if (evidence.length > EVIDENCE_LIMITS.facts) {
    invalidInput("EVIDENCE_LIMIT", "snapshot.evidence", `At most ${EVIDENCE_LIMITS.facts} evidence rows`);
  }
  let evidenceDependencyRefs = 0;
  for (const row of evidence)
    evidenceDependencyRefs += row.dependsOn.length;
  if (evidenceDependencyRefs > EVIDENCE_LIMITS.dependencies) {
    invalidInput("EVIDENCE_LIMIT", "snapshot", `At most ${EVIDENCE_LIMITS.dependencies} evidence dependency references`);
  }
  let itemDependencyRefs = 0;
  for (const item of items)
    itemDependencyRefs += item.dependsOn.length;
  if (itemDependencyRefs > M1_ITEM_LIMIT) {
    invalidInput("JSON_LIMIT", "snapshot.items", `At most ${M1_ITEM_LIMIT} item dependency references`);
  }
  canonicalize({ sources, evidence });
  return { schemaVersion: "commons.evidence-snapshot.v1", asOf: value.asOf, items, sources, evidence };
}
function parseSchema(raw) {
  const value = parseStrictJson(raw);
  if (!isRecord2(value))
    invalidInput("INVALID_INPUT", "schema", "Schema must be an object");
  exactKeys(value, ["schemaVersion", "id", "version", "fields"], "schema");
  if (value.schemaVersion !== "commons.field-schema.v1")
    invalidInput("INVALID_INPUT", "schema.schemaVersion", "Unsupported field schema");
  requiredId(value.id, "schema.id");
  requiredId(value.version, "schema.version");
  if (!Array.isArray(value.fields))
    invalidInput("INVALID_INPUT", "schema.fields", "fields must be an array");
  const fields = value.fields.map((field, index) => {
    if (!isRecord2(field))
      invalidInput("INVALID_INPUT", `schema.fields[${index}]`, "Field must be an object");
    exactKeys(field, FIELD_KEYS, "field");
    requiredId(field.name, "field.name");
    requiredId(field.owner, "field.owner");
    const type = field.type;
    if (type !== "boolean" && type !== "integer" && type !== "nonempty-string" && type !== "integer-range") {
      invalidInput("INVALID_INPUT", `schema.fields[${index}].type`, "Unsupported field type");
    }
    if (typeof field.required !== "boolean" || typeof field.eligibility !== "boolean" || typeof field.disqualifier !== "boolean") {
      invalidInput("INVALID_INPUT", `schema.fields[${index}]`, "required, eligibility and disqualifier must be boolean");
    }
    if (field.eligibility && !field.required)
      invalidInput("INVALID_INPUT", `schema.fields[${index}]`, "eligibility fields must be required");
    if (!Array.isArray(field.issuerAuthorities))
      invalidInput("INVALID_INPUT", `schema.fields[${index}].issuerAuthorities`, "issuerAuthorities must be an array");
    for (const auth of field.issuerAuthorities)
      requiredId(auth, "issuerAuthorities entry");
    if ("unit" in field)
      requiredId(field.unit, "field.unit");
    return {
      name: field.name,
      type,
      issuerAuthorities: sortUniqueStrings(field.issuerAuthorities, `schema.fields[${index}].issuerAuthorities`),
      required: field.required,
      eligibility: field.eligibility,
      disqualifier: field.disqualifier,
      owner: field.owner,
      ...field.unit !== void 0 ? { unit: field.unit } : {}
    };
  });
  const names = /* @__PURE__ */ new Set();
  for (const field of fields) {
    if (names.has(field.name))
      invalidInput("DUPLICATE_ID", "schema.fields", `Duplicate field name: ${field.name}`);
    names.add(field.name);
  }
  fields.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { schemaVersion: "commons.field-schema.v1", id: value.id, version: value.version, fields };
}
function parsePolicy(raw) {
  const value = parseStrictJson(raw);
  if (!isRecord2(value))
    invalidInput("INVALID_INPUT", "policy", "Policy must be an object");
  exactKeys(value, POLICY_KEYS, "policy");
  if (value.schemaVersion !== "commons.m1-policy.v1")
    invalidInput("INVALID_INPUT", "policy.schemaVersion", "Unsupported M1 policy schema");
  requiredId(value.id, "policy.id");
  requiredId(value.version, "policy.version");
  if (value.priorityOrder !== "ascending" && value.priorityOrder !== "descending") {
    invalidInput("INVALID_INPUT", "policy.priorityOrder", "priorityOrder must be ascending or descending");
  }
  return {
    schemaVersion: "commons.m1-policy.v1",
    id: value.id,
    version: value.version,
    priorityOrder: value.priorityOrder
  };
}
function sortItems(context) {
  const sign = context.policy.priorityOrder === "ascending" ? 1 : -1;
  const items = [...context.snapshot.items].sort((a, b) => {
    if (a.priority === b.priority)
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return (a.priority - b.priority) * sign;
  });
  return { ...context, snapshot: { ...context.snapshot, items } };
}
function validateM1Inputs(snapshotText, schemaText, policyText) {
  const context = {
    snapshot: parseSnapshot(snapshotText),
    schema: parseSchema(schemaText),
    policy: parsePolicy(policyText),
    snapshotText,
    schemaText,
    policyText
  };
  return sortItems(context);
}
function evaluateValidate(snapshotText, schemaText, policyText) {
  return validateM1Inputs(snapshotText, schemaText, policyText);
}

// dist/src/m1/link.js
function evaluateLink(context) {
  const items = context.snapshot.items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const issues = [];
  for (const item of items) {
    for (const dep of item.dependsOn) {
      if (!byId.has(dep)) {
        issues.push({
          code: "MISSING_DEPENDENCY",
          itemId: item.id,
          owner: item.owner,
          dependencyIds: [dep],
          question: `Supply dependency ${dep} referenced by ${item.id}, or submit a corrected dependency declaration.`
        });
      }
    }
  }
  const itemIds = [...byId.keys()];
  const dependencies = /* @__PURE__ */ new Map();
  const dependents = /* @__PURE__ */ new Map();
  for (const id of itemIds) {
    dependencies.set(id, [...byId.get(id)?.dependsOn ?? []]);
    dependents.set(id, []);
  }
  for (const item of items) {
    for (const dep of item.dependsOn) {
      if (dependents.has(dep))
        dependents.get(dep).push(item.id);
    }
  }
  const visited = /* @__PURE__ */ new Set();
  const finished = [];
  for (const id of itemIds) {
    if (visited.has(id))
      continue;
    visited.add(id);
    const stack = [{ id, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const edges = (dependencies.get(frame.id) ?? []).filter((d) => byId.has(d));
      if (frame.next === edges.length) {
        finished.push(frame.id);
        stack.pop();
        continue;
      }
      const child = edges[frame.next++];
      if (!visited.has(child)) {
        visited.add(child);
        stack.push({ id: child, next: 0 });
      }
    }
  }
  visited.clear();
  for (let index = finished.length - 1; index >= 0; index--) {
    const id = finished[index];
    if (visited.has(id))
      continue;
    visited.add(id);
    const members = [];
    const stack = [id];
    while (stack.length) {
      const member = stack.pop();
      members.push(member);
      for (const parent of dependents.get(member) ?? []) {
        if (!visited.has(parent)) {
          visited.add(parent);
          stack.push(parent);
        }
      }
    }
    const cyclic = members.length > 1 || (dependencies.get(id) ?? []).includes(id);
    if (cyclic) {
      const sorted = [...new Set(members)].sort();
      const memberSet = new Set(sorted);
      const anchor = sorted[0];
      const question = sorted.length <= 32 ? `Correct the dependency cycle involving ${sorted.join(", ")}.` : `DEPENDENCY_CYCLE component ${anchor} size ${sorted.length}`;
      for (const itemId of sorted) {
        const cyclicDeps = (dependencies.get(itemId) ?? []).filter((d) => memberSet.has(d)).sort();
        issues.push({
          code: "DEPENDENCY_CYCLE",
          itemId,
          owner: byId.get(itemId)?.owner ?? "unknown-owner",
          dependencyIds: cyclicDeps.length ? cyclicDeps : [anchor],
          question
        });
      }
    }
  }
  issues.sort((a, b) => a.code === b.code ? a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0 : a.code < b.code ? -1 : 1);
  return { issues };
}

// dist/src/m1/timebox.js
function classifyInterval(observedAt, expiresAt, asOf) {
  const now = timestamp(asOf, "asOf");
  const start = timestamp(observedAt, "observedAt");
  const end = timestamp(expiresAt, "expiresAt");
  if (now < start)
    return "FUTURE";
  if (now >= end)
    return "EXPIRED";
  return "CURRENT";
}
function evaluateTimebox(evidence, asOf) {
  return evidence.map((row) => ({ id: row.id, status: classifyInterval(row.observedAt, row.expiresAt, asOf) }));
}

// dist/src/m1/claim-key.js
var SEP = "";
function fieldClaimKey(itemId, fieldName) {
  if (itemId.includes(SEP) || fieldName.includes(SEP)) {
    throw new TypeError("itemId and fieldName may not contain the unit separator");
  }
  return `${itemId}${SEP}${fieldName}`;
}

// dist/src/m1/typed-value.js
function isRecord3(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function assertTypedFieldValue(value, type, path) {
  if (type === "boolean") {
    if (typeof value !== "boolean")
      invalidInput("INVALID_INPUT", path, "Expected boolean value");
    return;
  }
  if (type === "integer") {
    if (typeof value !== "number" || !Number.isSafeInteger(value))
      invalidInput("INVALID_INPUT", path, "Expected safe integer value");
    return;
  }
  if (type === "nonempty-string") {
    if (typeof value !== "string" || !/\S/.test(value))
      invalidInput("INVALID_INPUT", path, "Expected nonempty string value");
    return;
  }
  if (!isRecord3(value))
    invalidInput("INVALID_INPUT", path, "Expected integer-range object");
  exactKeys(value, ["low", "high"], "integer-range");
  if (typeof value.low !== "number" || typeof value.high !== "number" || !Number.isSafeInteger(value.low) || !Number.isSafeInteger(value.high)) {
    invalidInput("INVALID_INPUT", path, "Range bounds must be safe integers");
  }
  if (value.low > value.high)
    invalidInput("INVALID_RANGE", path, "Range low must not exceed high");
}
function typedValueIdentity(value, type) {
  if (type === "integer-range" && isRecord3(value))
    return `range:${value.low}:${value.high}`;
  return `${type}:${JSON.stringify(value)}`;
}

// dist/src/m1/admit.js
function fieldDef(context, name) {
  return context.schema.fields.find((f) => f.name === name);
}
function toFact(row, unit, admissionExcluded) {
  return {
    id: row.id,
    sourceId: row.sourceId,
    value: row.value,
    claimId: fieldClaimKey(row.itemId, row.field),
    ...unit ? { unit } : {},
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
    dependsOn: row.dependsOn,
    ...admissionExcluded?.length ? { admissionExcluded: [...admissionExcluded].sort() } : {}
  };
}
function buildBundle(context, rows) {
  return {
    sources: context.snapshot.sources,
    facts: context.snapshot.evidence.map((evidence) => {
      const row = rows.find((r) => r.evidence.id === evidence.id);
      const field = fieldDef(context, evidence.field);
      const codes = row.status === "EXCLUDED" && row.boundaryExcluded ? row.codes : void 0;
      return toFact(evidence, field?.unit, codes);
    })
  };
}
function evaluateAdmit(context) {
  const rows = [];
  for (const evidence of context.snapshot.evidence) {
    const codes = [];
    const field = fieldDef(context, evidence.field);
    if (!field) {
      codes.push("UNKNOWN_FIELD");
    } else {
      assertTypedFieldValue(evidence.value, field.type, `snapshot.evidence.${evidence.id}.value`);
      if (evidence.subjectId !== evidence.itemId)
        codes.push("WRONG_SUBJECT");
      if (!field.issuerAuthorities.includes(evidence.issuer))
        codes.push("UNAUTHORIZED_ISSUER");
      const time = classifyInterval(evidence.observedAt, evidence.expiresAt, context.snapshot.asOf);
      if (time === "EXPIRED")
        codes.push("EXPIRED");
      if (time === "FUTURE")
        codes.push("FUTURE");
    }
    if (codes.length) {
      rows.push({ evidence, status: "EXCLUDED", codes: [...new Set(codes)].sort(), boundaryExcluded: true });
    } else {
      rows.push({ evidence, status: "ADMITTED", codes: [], boundaryExcluded: false });
    }
  }
  const directBundle = buildBundle(context, rows);
  const report = inspectEvidence(directBundle, context.snapshot.asOf, { m1AdmitBoundary: true });
  const available = new Set(report.facts.filter((f) => f.status === "AVAILABLE").map((f) => f.id));
  const admittedIds = [];
  for (const row of rows) {
    if (row.status !== "ADMITTED")
      continue;
    if (!available.has(row.evidence.id)) {
      row.status = "EXCLUDED";
      const state = report.facts.find((f) => f.id === row.evidence.id);
      row.codes = [.../* @__PURE__ */ new Set([...state?.reasons ?? ["UNAVAILABLE"]])].sort();
      row.boundaryExcluded = false;
    } else {
      admittedIds.push(row.evidence.id);
    }
  }
  admittedIds.sort();
  const admittedRows = rows.filter((r) => r.status === "ADMITTED");
  const finalBundle = {
    sources: context.snapshot.sources,
    facts: admittedRows.map((r) => toFact(r.evidence, fieldDef(context, r.evidence.field)?.unit))
  };
  return { rows, admittedIds, directBundle, bundle: finalBundle };
}

// dist/src/m1/facts.js
function evaluateFacts(context, admit) {
  const report = inspectEvidence(admit.directBundle, context.snapshot.asOf, { m1AdmitBoundary: true });
  const statusById = new Map(report.facts.map((f) => [f.id, f.status]));
  const fields = [];
  let knownRequired = 0;
  let requiredCount = 0;
  for (const item of context.snapshot.items) {
    for (const field of context.schema.fields) {
      if (field.required)
        requiredCount++;
      const claim = fieldClaimKey(item.id, field.name);
      const rows = admit.directBundle.facts.filter((f) => f.claimId === claim);
      const evidenceIds = rows.map((r) => r.id).sort();
      if (!rows.length) {
        fields.push({ itemId: item.id, field: field.name, state: "UNKNOWN", evidenceIds: [] });
        continue;
      }
      const available = rows.filter((r) => statusById.get(r.id) === "AVAILABLE");
      if (available.length) {
        const groups = new Set(available.map((f) => typedValueIdentity(f.value, field.type)));
        if (groups.size === 1) {
          fields.push({
            itemId: item.id,
            field: field.name,
            state: "KNOWN",
            value: available[0].value,
            evidenceIds: available.map((r) => r.id).sort()
          });
          if (field.required)
            knownRequired++;
        } else {
          fields.push({ itemId: item.id, field: field.name, state: "CONFLICT", evidenceIds });
        }
        continue;
      }
      const statuses = rows.map((r) => statusById.get(r.id) ?? "MISSING");
      if (statuses.some((s) => s === "CONFLICT")) {
        const groups = /* @__PURE__ */ new Map();
        for (const fact of rows) {
          const key = typedValueIdentity(fact.value, field.type);
          const ids = groups.get(key) ?? [];
          ids.push(fact.id);
          groups.set(key, ids);
        }
        if (groups.size <= 1) {
          fields.push({ itemId: item.id, field: field.name, state: "UNKNOWN", evidenceIds });
          continue;
        }
        const valueGroups = [...groups.entries()].map(([canonical, ids]) => ({ canonical, evidenceIds: [...ids].sort() }));
        valueGroups.sort((a, b) => a.canonical < b.canonical ? -1 : a.canonical > b.canonical ? 1 : 0);
        fields.push({ itemId: item.id, field: field.name, state: "CONFLICT", evidenceIds, valueGroups });
        continue;
      }
      fields.push({ itemId: item.id, field: field.name, state: "UNKNOWN", evidenceIds });
    }
  }
  fields.sort((a, b) => a.itemId === b.itemId ? a.field < b.field ? -1 : a.field > b.field ? 1 : 0 : a.itemId < b.itemId ? -1 : 1);
  return { fields, knownRequired, requiredCount };
}

// dist/src/runtime.js
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { join as join2, relative, dirname as dirname2 } from "node:path";
import { endianness } from "node:os";

// dist/src/package-root.js
import { dirname, basename, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
var moduleDirectory = dirname(fileURLToPath(import.meta.url));
var packageRoot = resolve(moduleDirectory, basename(dirname(moduleDirectory)) === "dist" ? "../.." : "..");
var packagePath = (...parts) => join(packageRoot, ...parts);

// dist/src/runtime.js
var root = dirname2(fileURLToPath2(import.meta.url));
function sourceFiles(dir, extension) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? sourceFiles(join2(dir, e.name), extension) : e.isFile() && e.name.endsWith(extension) && !e.name.endsWith(".d.ts") ? [join2(dir, e.name)] : []).sort();
}
function treeDigest(directory, extension) {
  return sha256(sourceFiles(directory, extension).map((p) => ({ path: relative(directory, p).split("\\").join("/"), source: readFileSync(p, "utf8") })));
}
function executionRuntime() {
  const srcDir = packagePath("src");
  const codeExt = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const codeDigest = treeDigest(root, codeExt);
  const sourceDigest = existsSync(srcDir) ? treeDigest(srcDir, ".ts") : codeDigest;
  return {
    implementation: "@cosmic/commons/0.2.2",
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    architecture: process.arch,
    endianness: endianness(),
    sourceDigest,
    codeDigest
  };
}

// dist/src/m1/receipt.js
var PENDING = ["Bound", "Stress", "Window", "Challenge", "Gate", "Portfolio"];
function receiptBudget(context) {
  return context.snapshot.items.length > 512 ? M1_RECEIPT_CANONICAL_BUDGET : void 0;
}
function digestNormalized(value, budget) {
  return budget ? sha256Bytes(canonicalize(value, budget)) : sha256(value);
}
function buildM1Receipt(context, linkIssues, admit, facts, tracesByItem) {
  const budget = receiptBudget(context);
  const normalizedSnapshot = JSON.parse(canonicalize(context.snapshot, budget));
  const normalizedSchema = JSON.parse(canonicalize(context.schema, budget));
  const normalizedPolicy = JSON.parse(canonicalize(context.policy, budget));
  const inputDigest = digestNormalized(normalizedSnapshot, budget);
  const runtime = executionRuntime();
  const items = context.snapshot.items.map((item) => {
    const itemFacts = facts.fields.filter((f) => f.itemId === item.id);
    const itemLink = linkIssues.filter((issue) => issue.itemId === item.id);
    const reasons = [];
    for (const issue of itemLink) {
      reasons.push({
        owner: issue.owner,
        engine: "Link",
        code: issue.code,
        question: issue.question,
        itemId: item.id,
        evidenceIds: [],
        dependencyIds: [...issue.dependencyIds].sort()
      });
    }
    for (const field of itemFacts) {
      const schemaField = context.schema.fields.find((f) => f.name === field.field);
      if (field.state === "CONFLICT") {
        reasons.push({
          owner: schemaField.owner,
          engine: "Facts",
          code: "FIELD_CONFLICT",
          question: `Resolve conflicting ${field.field} evidence for ${item.id}.`,
          itemId: item.id,
          field: field.field,
          evidenceIds: field.evidenceIds,
          dependencyIds: []
        });
      } else if (field.state === "UNKNOWN" && schemaField.required) {
        reasons.push({
          owner: schemaField.owner,
          engine: "Facts",
          code: "MISSING_REQUIRED_FIELD",
          question: `Supply current ${field.field} evidence for ${item.id}.`,
          itemId: item.id,
          field: field.field,
          evidenceIds: [],
          dependencyIds: []
        });
      }
    }
    for (const row of admit.rows.filter((r) => r.evidence.itemId === item.id && r.status === "EXCLUDED")) {
      const schemaField = context.schema.fields.find((f) => f.name === row.evidence.field);
      reasons.push({
        owner: schemaField?.owner ?? item.owner,
        engine: "Admit",
        code: row.codes[0] ?? "EXCLUDED",
        question: `Replace ${row.evidence.id}: ${row.codes.join(", ")}.`,
        itemId: item.id,
        field: row.evidence.field,
        evidenceIds: [row.evidence.id],
        dependencyIds: []
      });
    }
    reasons.sort((a, b) => {
      const codeCmp = a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
      if (codeCmp !== 0)
        return codeCmp;
      const af = a.field ?? "";
      const bf = b.field ?? "";
      return af < bf ? -1 : af > bf ? 1 : 0;
    });
    const hasBlocker = itemLink.length > 0 || itemFacts.some((f) => f.state === "CONFLICT") || itemFacts.some((f) => {
      const sf = context.schema.fields.find((x) => x.name === f.field);
      return sf?.required && f.state === "UNKNOWN";
    });
    return {
      itemId: item.id,
      evidenceStatus: hasBlocker ? "INCOMPLETE" : "COMPLETE",
      routingDisposition: hasBlocker ? "NEEDS_EVIDENCE" : null,
      finalDecision: null,
      finalDecisionStatus: "NOT_EVALUATED",
      reasons,
      facts: itemFacts,
      traces: tracesByItem.get(item.id) ?? []
    };
  });
  const body = {
    schemaVersion: "commons.m1-evidence-receipt.v1",
    evaluationScope: "M1_EVIDENCE_ONLY",
    inputs: { snapshot: normalizedSnapshot, schema: normalizedSchema, policy: normalizedPolicy },
    inputDigest,
    schemaDigest: digestNormalized(normalizedSchema, budget),
    policyDigest: digestNormalized(normalizedPolicy, budget),
    artifactIdentity: runtime.sourceDigest,
    runtimeIdentity: canonicalize({
      node: runtime.node,
      v8: runtime.v8,
      platform: runtime.platform,
      architecture: runtime.architecture,
      endianness: runtime.endianness,
      sourceDigest: runtime.sourceDigest,
      codeDigest: runtime.codeDigest
    }),
    items,
    pendingStages: PENDING,
    knownRequired: facts.knownRequired,
    requiredCount: facts.requiredCount
  };
  const digest = sha256Bytes(canonicalize(body, budget ?? M1_RECEIPT_CANONICAL_BUDGET));
  return { ...body, digest };
}

// dist/src/m1/evaluate.js
function evaluateEvidence(snapshotText, schemaText, policyText) {
  try {
    const context = evaluateValidate(snapshotText, schemaText, policyText);
    if (context.snapshot.items.length > M1_RECEIPT_ITEM_LIMIT) {
      invalidInput("M1_RECEIPT_LIMIT", "snapshot.items", `M1 evidence receipts support at most ${M1_RECEIPT_ITEM_LIMIT} items`);
    }
    if (context.snapshot.items.length > M1_RECEIPT_TRACE_LIMIT) {
      invalidInput("M1_RECEIPT_LIMIT", "snapshot.items", `M1 evidence receipts with per-item traces support at most ${M1_RECEIPT_TRACE_LIMIT} items`);
    }
    for (const evidence of context.snapshot.evidence) {
      if (!context.schema.fields.some((f) => f.name === evidence.field)) {
        return { ok: false, code: "INVALID_INPUT", path: `snapshot.evidence.${evidence.id}.field`, message: "Unknown field" };
      }
    }
    const link = evaluateLink(context);
    const timebox = evaluateTimebox(context.snapshot.evidence, context.snapshot.asOf);
    const admit = evaluateAdmit(context);
    const facts = evaluateFacts(context, admit);
    const tracesByItem = /* @__PURE__ */ new Map();
    for (const item of context.snapshot.items) {
      tracesByItem.set(item.id, [
        { stage: "Validate", status: "OK", codes: [] },
        { stage: "Link", status: link.issues.some((i) => i.itemId === item.id) ? "ISSUES" : "OK", codes: link.issues.filter((i) => i.itemId === item.id).map((i) => i.code) },
        { stage: "Timebox", status: "OK", codes: timebox.filter((t) => context.snapshot.evidence.some((e) => e.id === t.id && e.itemId === item.id)).map((t) => t.status) },
        { stage: "Admit", status: "OK", codes: admit.rows.filter((r) => r.evidence.itemId === item.id && r.status === "EXCLUDED").flatMap((r) => r.codes) },
        { stage: "Facts", status: "OK", codes: facts.fields.filter((f) => f.itemId === item.id && f.state === "CONFLICT").map(() => "CONFLICT") }
      ]);
    }
    const receipt = buildM1Receipt(context, link.issues, admit, facts, tracesByItem);
    return { ok: true, receipt, context };
  } catch (error) {
    const exposed = exposeInvalidInput(error);
    return { ok: false, ...exposed };
  }
}
export {
  evaluateEvidence as evaluate
};
