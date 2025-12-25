const SENSITIVE_KEYS = [
  "accesstoken",
  "refreshtoken",
  "authorization",
  "clientsecret",
  "secret",
  "password",
  "token"
];

function isSensitiveKey(key) {
  const k = String(key || "").toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}

function redact(value) {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? "[REDACTED]" : redact(v);
  }
  return out;
}

module.exports = {
  redact
};

