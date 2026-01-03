// Test script to understand discount inflation issue

// Mock the calcDiscountAmount function
function calcDiscountAmount(rules, subtotal) {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  const type = String(rules?.type || "").trim();
  const value = Number(rules?.value || 0);
  if (type === "percentage") {
    const pct = Math.max(0, Math.min(100, value));
    return (subtotal * pct) / 100;
  }
  if (type === "fixed") {
    const amt = Math.max(0, value);
    return Math.min(subtotal, amt);
  }
  return 0;
}

// Simulate the problematic scenario
console.log("=== Testing Discount Calculation ===");

// Test case: Bundle with 100 SAR discount
const rules = { type: "fixed", value: 100 };

// Scenario 1: Normal case - subtotal 1000, discount should be 100
const subtotal1 = 1000;
const discount1 = calcDiscountAmount(rules, subtotal1);
console.log(`Subtotal: ${subtotal1}, Discount: ${discount1}`);

// Scenario 2: What if subtotal is inflated? - subtotal 2000, discount would be 100 (capped)
const subtotal2 = 2000;
const discount2 = calcDiscountAmount(rules, subtotal2);
console.log(`Subtotal: ${subtotal2}, Discount: ${discount2}`);

// Scenario 3: What if the same calculation is applied multiple times?
console.log("\n=== Testing Multiple Applications ===");
let totalDiscount = 0;
for (let i = 1; i <= 3; i++) {
  const discount = calcDiscountAmount(rules, subtotal1);
  totalDiscount += discount;
  console.log(`Application ${i}: Discount ${discount}, Total: ${totalDiscount}`);
}

// Scenario 4: What if subtotal increases each time?
console.log("\n=== Testing Inflating Subtotal ===");
let inflatingSubtotal = 1000;
let cumulativeDiscount = 0;
for (let i = 1; i <= 3; i++) {
  const discount = calcDiscountAmount(rules, inflatingSubtotal);
  cumulativeDiscount += discount;
  console.log(`Subtotal: ${inflatingSubtotal}, Discount: ${discount}, Cumulative: ${cumulativeDiscount}`);
  inflatingSubtotal += 500; // Simulate subtotal inflation
}