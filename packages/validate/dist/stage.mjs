// dist/src/canonical.js
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
var EVIDENCE_LIMITS = Object.freeze({ sources: 1e3, facts: 1e3, dependencies: 1e4 });
function requiredId(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > 256)
    throw new TypeError(`${label} must be a nonempty string of at most 256 characters without surrounding whitespace`);
}
function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new TypeError(`Unknown ${label} field: ${key}`);
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

// dist/src/m1/validate.js
var SNAPSHOT_KEYS = ["schemaVersion", "asOf", "items", "sources", "evidence"];
var ITEM_KEYS = ["id", "priority", "owner", "dependsOn"];
var EVIDENCE_KEYS = ["id", "itemId", "subjectId", "field", "issuer", "sourceId", "observedAt", "expiresAt", "value", "dependsOn"];
var FIELD_KEYS = ["name", "type", "issuerAuthorities", "required", "eligibility", "disqualifier", "owner", "unit"];
var POLICY_KEYS = ["schemaVersion", "id", "version", "priorityOrder"];
var SOURCE_KEYS = ["id", "uri", "content", "digest"];
var M1_ITEM_LIMIT = 2e4;
function isRecord(value) {
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
  if (!isRecord(source))
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
  if (!isRecord(value))
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
    if (!isRecord(item))
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
    if (!isRecord(row))
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
  if (!isRecord(value))
    invalidInput("INVALID_INPUT", "schema", "Schema must be an object");
  exactKeys(value, ["schemaVersion", "id", "version", "fields"], "schema");
  if (value.schemaVersion !== "commons.field-schema.v1")
    invalidInput("INVALID_INPUT", "schema.schemaVersion", "Unsupported field schema");
  requiredId(value.id, "schema.id");
  requiredId(value.version, "schema.version");
  if (!Array.isArray(value.fields))
    invalidInput("INVALID_INPUT", "schema.fields", "fields must be an array");
  const fields = value.fields.map((field, index) => {
    if (!isRecord(field))
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
  if (!isRecord(value))
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

// dist/src/runtime.js
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { join as join2, relative, dirname as dirname2 } from "node:path";

// dist/src/package-root.js
import { dirname, basename, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
var moduleDirectory = dirname(fileURLToPath(import.meta.url));
var packageRoot = resolve(moduleDirectory, basename(dirname(moduleDirectory)) === "dist" ? "../.." : "..");

// dist/src/runtime.js
var root = dirname2(fileURLToPath2(import.meta.url));
export {
  evaluateValidate as evaluate
};
