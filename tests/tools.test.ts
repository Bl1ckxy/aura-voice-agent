import { describe, expect, it } from 'vitest';
import { checkReturnEligibility, getOrderDetails, ORDERS } from '../server/data/orders';

describe('Aura order tools', () => {
  it('[UNIT] contains the three deterministic demo orders', () => {
    expect(Object.keys(ORDERS)).toEqual(['ORD-101', 'ORD-102', 'ORD-103']);
    expect(getOrderDetails('ORD-101')).toMatchObject({ status: 'Out for Delivery', shipping: 'BlueDart BD-982103' });
    expect(getOrderDetails('ORD-102')).toMatchObject({ status: 'Delivered', deliveredDaysAgo: 14 });
    expect(getOrderDetails('ORD-103')).toMatchObject({ status: 'Processing', eligibleForCancellation: true });
  });

  it('[UNIT] returns a safe not-found result', () => {
    expect(getOrderDetails('ORD-999')).toEqual({ found: false, message: 'No order found with ID ORD-999' });
    expect(checkReturnEligibility('ORD-999', 'return')).toMatchObject({ eligible: false });
  });

  it('[UNIT] enforces return and cancellation policy', () => {
    expect(checkReturnEligibility('ORD-102', 'return').eligible).toBe(false);
    expect(checkReturnEligibility('ORD-103', 'cancellation')).toMatchObject({ eligible: true, type: 'cancellation' });
    expect(checkReturnEligibility('ORD-101', 'cancellation')).toMatchObject({ eligible: false, type: 'cancellation' });
  });
});
