export function shouldEscalate({ customerRequestedHuman, confidence, attempts, needsApproval, outOfScope, frustration } = {}) {
  if (customerRequestedHuman) return { escalate: true, reason: 'customer_requested_human' };
  if (needsApproval) return { escalate: true, reason: 'action_requires_approval' };
  if (outOfScope) return { escalate: true, reason: 'out_of_scope' };
  if (frustration) return { escalate: true, reason: 'detected_frustration' };
  if (typeof attempts === 'number' && attempts >= 3) return { escalate: true, reason: 'too_many_attempts' };
  if (typeof confidence === 'number' && confidence < 0.55) return { escalate: true, reason: 'low_confidence' };
  return { escalate: false, reason: null };
}
