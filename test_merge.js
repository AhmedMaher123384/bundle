// Test the mergeBundlesSummary function behavior
const { mergeBundlesSummary } = require('./backend/src/services/cartCoupon.service.js');

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