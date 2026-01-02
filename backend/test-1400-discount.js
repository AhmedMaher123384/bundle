// Test script to verify 1400 discount logic
const { computeMinPurchaseAmountForDiscount } = require('./src/services/cartCoupon.service');

console.log('Testing 1400 discount calculation:');
const discountAmount = 1400;
const minPurchaseAmount = computeMinPurchaseAmountForDiscount(discountAmount);
console.log(`Discount: ${discountAmount}, Min Purchase: ${minPurchaseAmount}`);
console.log(`Is discount < min purchase? ${discountAmount < minPurchaseAmount}`);

// Test the bundle evaluation logic
const { evaluateBundles } = require('./src/services/bundle.service');

// Mock merchant and cart items
const mockMerchant = { _id: 'test-merchant', merchantId: 'test-store' };
const mockCartItems = [
  { variantId: 'test-variant-1', quantity: 1 }
];

// Mock variant snapshot
const mockVariantSnapshot = new Map([
  ['test-variant-1', { variantId: 'test-variant-1', productId: 'test-product-1', price: 2000, isActive: true }]
]);

console.log('\nTesting bundle evaluation with 1400 discount:');
console.log('This would require actual bundle data to test properly.');
console.log('The issue is likely that the bundle is not being loaded or matched.');