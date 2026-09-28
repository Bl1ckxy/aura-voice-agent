export interface Order {
  id: string;
  customer: string;
  product: string;
  price: number;
  status: 'Processing' | 'Out for Delivery' | 'Delivered';
  shipping: string | null;
  expectedBy?: string;
  deliveredAt?: string;
  orderedAt?: string;
  eligibleForCancellation?: boolean;
  deliveredDaysAgo?: number;
}

export interface ReturnEligibilityResult {
  eligible: boolean;
  action: string;
  type?: string;
  reason: string;
}

const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

export const ORDERS: Record<string, Order> = {
  'ORD-101': {
    id: 'ORD-101',
    customer: 'Priya Sharma',
    product: 'Vitamin C Serum (30ml)',
    price: 699,
    status: 'Out for Delivery',
    shipping: 'BlueDart BD-982103',
    expectedBy: '6 PM today',
  },
  'ORD-102': {
    id: 'ORD-102',
    customer: 'Rahul Verma',
    product: 'Hydrating Sunscreen SPF 50',
    price: 499,
    status: 'Delivered',
    shipping: 'Delhivery DL-441029',
    deliveredAt: '14 days ago',
    deliveredDaysAgo: 14,
  },
  'ORD-103': {
    id: 'ORD-103',
    customer: 'Ananya Patel',
    product: 'Green Tea Face Wash + Toner',
    price: 850,
    status: 'Processing',
    shipping: null,
    orderedAt: '3 hours ago',
    eligibleForCancellation: true,
  },
};

export function normalizeOrderId(rawId: string): string {
  const input = String(rawId || '').toLowerCase();
  const words = input
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => NUMBER_WORDS[word] ?? word);
  const compact = words.join('').replace(/[^a-z0-9]/g, '');
  const digits = compact.match(/(?:ord)?((?:10[1-3])|(?:[1-3]\s*[0-9]{2}))/)?.[1]
    ?? compact.match(/10[1-3]/)?.[0]
    ?? '';
  const normalizedDigits = digits.replace(/\s/g, '');
  return /^10[1-3]$/.test(normalizedDigits) ? `ORD-${normalizedDigits}` : '';
}

export function getOrderDetails(orderId: string): Order | { found: false; message: string } {
  const normalizedId = normalizeOrderId(orderId);
  const order = ORDERS[normalizedId];
  return order ?? { found: false, message: `No order found with ID ${normalizedId || orderId}` };
}

const VALID_ACTIONS = ['return', 'cancellation', 'refund'];

export function checkReturnEligibility(orderId: string, action: string): ReturnEligibilityResult {
  const normalizedId = normalizeOrderId(orderId);
  const order = ORDERS[normalizedId];
  const normalizedAction = VALID_ACTIONS.includes(action) ? action : 'return';
  const type = normalizedAction === 'cancellation' ? 'cancellation' : 'return';

  if (!order) {
    return {
      eligible: false,
      action: normalizedAction,
      type,
      reason: `Order ${normalizedId || orderId} not found. Please verify the order ID.`,
    };
  }

  if (normalizedAction === 'cancellation') {
    if (order.status === 'Processing') {
      return {
        eligible: true,
        action: 'cancellation',
        type: 'cancellation',
        reason: 'Order is processing and can be cancelled immediately.',
      };
    }
    if (order.status === 'Out for Delivery') {
      return {
        eligible: false,
        action: 'cancellation',
        type: 'cancellation',
        reason: 'Order is out for delivery. Customer can refuse delivery at doorstep.',
      };
    }
    return {
      eligible: false,
      action: 'cancellation',
      type: 'cancellation',
      reason: 'Order has already been delivered, so it can no longer be cancelled. A return may still be possible within 7 days of delivery.',
    };
  }

  if (order.status !== 'Delivered') {
    return {
      eligible: false,
      action: normalizedAction,
      type: 'return',
      reason: `Order has not been delivered yet (status: ${order.status}). Returns are only available after delivery.`,
    };
  }

  const daysSinceDelivery = order.deliveredDaysAgo ?? 0;
  if (daysSinceDelivery > 7) {
    return {
      eligible: false,
      action: normalizedAction,
      type: 'return',
      reason: `Product was delivered ${daysSinceDelivery} days ago, which exceeds the 7-day return policy. Also, returns require unopened original packaging.`,
    };
  }

  return {
    eligible: true,
    action: normalizedAction,
    type: 'return',
    reason: `Order was delivered ${daysSinceDelivery} days ago and is within the 7-day return window.`,
  };
}
