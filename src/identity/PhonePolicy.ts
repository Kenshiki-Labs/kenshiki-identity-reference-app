// Responsibility: Determines when subscriber observations prevent phone-step completion in this host.
// Control: Treats contradictory or unsatisfied comparisons as a stop; it does not authenticate receipts.
// Native counterpart: PhonePossessionSession supplies the receipt and subscriber comparison observations.
// Specification: RFC-0002 §§4.2–4.3; capability-evidence-and-assurance-plan §3.6.

import type { PhoneCheckReceipt, PhoneCheckSnapshot } from '@kenshiki/identity-capture';

/** Host policy: contradictory subscriber evidence cannot complete the phone step. */
export function phoneCheckStopped(receipt: PhoneCheckReceipt): boolean {
  return (
    receipt.subjectComparison?.status === 'contradicted' ||
    receipt.subscriberComparison?.evaluation.status === 'notSatisfied'
  );
}

/** A prior receipt or a pending/failed attempt cannot complete this phone step. */
export function phoneCheckComplete(snapshot: PhoneCheckSnapshot | undefined): boolean {
  return (
    !!snapshot?.receipt &&
    snapshot.stage === 'completed' &&
    !snapshot.pending &&
    !snapshot.busy &&
    !snapshot.failure &&
    !phoneCheckStopped(snapshot.receipt)
  );
}
