import type { PhoneCheckReceipt } from '@kenshiki/identity-capture';

/** Host policy: contradictory subscriber evidence cannot complete the phone step. */
export function phoneCheckStopped(receipt: PhoneCheckReceipt): boolean {
  return (
    receipt.subjectComparison?.status === 'contradicted' ||
    receipt.subscriberComparison?.evaluation.status === 'notSatisfied'
  );
}
