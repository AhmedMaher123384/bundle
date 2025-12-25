const mongoose = require("mongoose");
const { loadConfig } = require("../src/config/env");
const { connectToMongo } = require("../src/config/db");
const Merchant = require("../src/models/Merchant");
const Bundle = require("../src/models/Bundle");

/**
 * Reads CLI args:
 * - `--uri` or `--mongodb-uri`
 * - `--db` or `--db-name`
 * @param {string[]} argv
 * @returns {{ uri?: string, dbName?: string }}
 */
function readSeedArgs(argv) {
  const getValue = (key) => {
    const idx = argv.indexOf(key);
    if (idx === -1) return undefined;
    const val = argv[idx + 1];
    if (!val || val.startsWith("--")) return undefined;
    return val;
  };

  return {
    uri: getValue("--uri") || getValue("--mongodb-uri"),
    dbName: getValue("--db") || getValue("--db-name"),
    migrateBundles: argv.includes("--migrate-bundles")
  };
}

function toInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function normalizeVariantId(value) {
  const v = String(value || "").trim();
  return v || null;
}

function normalizeGroup(value) {
  const v = String(value || "").trim();
  return v || "A";
}

function normalizeRules(doc) {
  const rules = doc?.rules || {};
  const rawType = String(rules?.type || doc?.discountType || doc?.discount_type || doc?.type || "").trim().toLowerCase();
  const type = rawType === "percentage" || rawType === "percent" ? "percentage" : rawType === "fixed" ? "fixed" : null;
  const rawValue = rules?.value ?? doc?.discountValue ?? doc?.discount_value ?? doc?.value;
  const value = Number(rawValue);

  const eligibility = {
    mustIncludeAllGroups:
      rules?.eligibility?.mustIncludeAllGroups != null ? Boolean(rules.eligibility.mustIncludeAllGroups) : true,
    minCartQty: Math.max(1, toInt(rules?.eligibility?.minCartQty ?? doc?.minCartQty ?? 1, 1))
  };

  const limits = {
    maxUsesPerOrder: Math.max(1, toInt(rules?.limits?.maxUsesPerOrder ?? doc?.maxUsesPerOrder ?? 10, 10))
  };

  if (!type || !Number.isFinite(value) || value < 0) {
    return {
      rules: {
        type: "fixed",
        value: 0,
        eligibility,
        limits
      },
      degraded: true
    };
  }

  return {
    rules: {
      type,
      value: Number(value),
      eligibility,
      limits
    },
    degraded: false
  };
}

function normalizeComponents(doc) {
  const candidates = [doc?.components, doc?.items, doc?.products, doc?.variants, doc?.bundleItems].filter((c) => Array.isArray(c));
  const base = candidates[0] || [];

  const groupFromParent =
    typeof doc?.group === "string"
      ? doc.group
      : typeof doc?.groupName === "string"
        ? doc.groupName
        : typeof doc?.defaultGroup === "string"
          ? doc.defaultGroup
          : null;

  const components = base
    .map((it, idx) => {
      const variantId = normalizeVariantId(it?.variantId ?? it?.variant_id ?? it?.variant?.id ?? it?.id);
      const quantity = Math.max(1, toInt(it?.quantity ?? it?.qty ?? it?.amount ?? it?.count ?? 1, 1));
      const group = normalizeGroup(it?.group ?? it?.groupName ?? it?.set ?? it?.section ?? groupFromParent ?? `G${idx + 1}`);
      if (!variantId) return null;
      return { variantId, quantity, group };
    })
    .filter(Boolean);

  const unique = new Map();
  for (const c of components) {
    const key = `${c.group}:${c.variantId}`;
    unique.set(key, { ...c, quantity: (unique.get(key)?.quantity || 0) + c.quantity });
  }

  return Array.from(unique.values());
}

function normalizePresentation(doc, components) {
  const coverVariantId =
    normalizeVariantId(doc?.presentation?.coverVariantId) ||
    normalizeVariantId(doc?.coverVariantId) ||
    normalizeVariantId(doc?.cover_variant_id) ||
    normalizeVariantId(components?.[0]?.variantId);
  return { coverVariantId: coverVariantId || undefined };
}

function isNewSchemaBundle(doc) {
  if (!doc || !Array.isArray(doc.components) || doc.components.length === 0) return false;
  const componentsOk = doc.components.every((c) => String(c?.variantId || "").trim() && String(c?.group || "").trim() && Number(c?.quantity) > 0);
  const rulesOk =
    (doc?.rules?.type === "fixed" || doc?.rules?.type === "percentage") &&
    Number.isFinite(Number(doc?.rules?.value)) &&
    Number(doc.rules.value) >= 0;
  return componentsOk && rulesOk;
}

async function migrateBundles() {
  const args = readSeedArgs(process.argv);
  if (!process.env.MONGODB_URI && args.uri) process.env.MONGODB_URI = args.uri;
  if (!process.env.MONGODB_DB_NAME && args.dbName) process.env.MONGODB_DB_NAME = args.dbName;

  const config = loadConfig();
  await connectToMongo(config);

  const collection = mongoose.connection.db.collection("bundles");
  const cursor = collection.find({});

  let scanned = 0;
  let migrated = 0;
  let degraded = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned += 1;
    if (isNewSchemaBundle(doc)) continue;

    const components = normalizeComponents(doc);
    const { rules, degraded: isDegraded } = normalizeRules(doc);
    const presentation = normalizePresentation(doc, components);

    const nextStatus = isDegraded ? "paused" : doc?.status || "paused";
    const nextName = String(doc?.name || doc?.title || "").trim() || "Migrated bundle";

    const update = {
      version: 1,
      status: nextStatus,
      name: nextName,
      components,
      rules,
      presentation,
      deletedAt: doc?.deletedAt ?? null
    };

    await collection.updateOne({ _id: doc._id }, { $set: update, $unset: { products: "", items: "", variants: "", bundleItems: "" } });
    migrated += 1;
    if (isDegraded) degraded += 1;
  }

  console.log("Bundles migration completed:", { scanned, migrated, degraded });
  await mongoose.disconnect();
}

/**
 * Seeds dummy stores/products/bundles for local testing.
 */
async function seed() {
  const args = readSeedArgs(process.argv);
  if (!process.env.MONGODB_URI && args.uri) process.env.MONGODB_URI = args.uri;
  if (!process.env.MONGODB_DB_NAME && args.dbName) process.env.MONGODB_DB_NAME = args.dbName;
  if (args.migrateBundles) return migrateBundles();

  const config = loadConfig();
  await connectToMongo(config);

  await Promise.all([Merchant.deleteMany({}), Bundle.deleteMany({})]);

  const merchant = await Merchant.create({
    merchantId: "123456",
    accessToken: "demo_access_token",
    refreshToken: "demo_refresh_token",
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
  });

  await Bundle.insertMany([
    {
      merchantId: merchant._id,
      version: 1,
      status: "active",
      name: "10% off Group A + Group B",
      components: [
        { variantId: "V-100-A", quantity: 1, group: "A" },
        { variantId: "V-200-A", quantity: 1, group: "B" }
      ],
      rules: {
        type: "percentage",
        value: 10,
        eligibility: { mustIncludeAllGroups: true, minCartQty: 2 },
        limits: { maxUsesPerOrder: 1 }
      },
      presentation: { coverVariantId: "V-100-A" },
      deletedAt: null
    },
    {
      merchantId: merchant._id,
      version: 1,
      status: "active",
      name: "Fixed 15 off Group A",
      components: [{ variantId: "V-200-A", quantity: 1, group: "A" }],
      rules: {
        type: "fixed",
        value: 15,
        eligibility: { mustIncludeAllGroups: true, minCartQty: 1 },
        limits: { maxUsesPerOrder: 1 }
      },
      presentation: { coverVariantId: "V-200-A" },
      deletedAt: null
    }
  ]);

  console.log("Seed completed:", { merchantId: merchant.merchantId });

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
