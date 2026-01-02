// Test the mergeBundlesSummary function behavior

function normalizeBundlesSummary(summary) {
  const out = [];
  for (const b of Array.isArray(summary) ? summary : []) {
    const bundleId = String(b?.bundleId || "").trim();
    const discountAmount = Number(b?.discountAmount || 0);
    if (!bundleId || !Number.isFinite(discountAmount) || discountAmount < 0) continue;
    out.push({ bundleId, discountAmount: Number(discountAmount.toFixed(2)) });
  }
  return out;
}

function mergeBundlesSummary(existingSummary, incomingSummary) {
  const map = new Map();
  for (const b of normalizeBundlesSummary(existingSummary)) map.set(b.bundleId, b.discountAmount);
  for (const b of normalizeBundlesSummary(incomingSummary)) map.set(b.bundleId, b.discountAmount);
  const merged = Array.from(map.entries()).map(([bundleId, discountAmount]) => ({ bundleId, discountAmount }));
  const total = merged.reduce((acc, b) => acc + Number(b.discountAmount || 0), 0);
  return {
    bundlesSummary: merged,
    appliedBundleIds: merged.map((b) => b.bundleId),
    discountAmount: Number(Number(total).toFixed(2))
  };
}

// Test case 1: Same bundle applied twice
const existing = [{ bundleId: "b1", discountAmount: 100 }];
const incoming = [{ bundleId: "b1", discountAmount: 100 }];

console.log("Test 1 - Same bundle applied twice:");
console.log("Existing:", existing);
console.log("Incoming:", incoming);

// This should replace, not accumulate
const result1 = mergeBundlesSummary(existing, incoming);
console.log("Result:", result1);
console.log("Expected discount: 100 (should replace, not accumulate)");
console.log("Actual discount:", result1.discountAmount);
console.log("");

// Test case 2: Different bundles
const existing2 = [{ bundleId: "b1", discountAmount: 100 }];
const incoming2 = [{ bundleId: "b2", discountAmount: 200 }];

console.log("Test 2 - Different bundles:");
console.log("Existing:", existing2);
console.log("Incoming:", incoming2);

const result2 = mergeBundlesSummary(existing2, incoming2);
console.log("Result:", result2);
console.log("Expected discount: 300 (should accumulate different bundles)");
console.log("Actual discount:", result2.discountAmount);