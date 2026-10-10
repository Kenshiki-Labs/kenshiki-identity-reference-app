import type { Configuration, PhoneCheckSnapshot } from '@kenshiki/identity-capture';

export const phoneConfiguration: NonNullable<Configuration['phone']> = {
  providerID: 'synthetic-phone',
  checkedDocumentID: 'synthetic-checked-document',
  workflowID: '00000000-0000-4000-8000-000000000001',
  directoryURL: 'file:///synthetic/phone',
  keychainService: 'synthetic-phone',
  keychainAccount: 'synthetic-phone',
  policy: { pollInterval: 3, rateLimitBackoff: 5, resendDelay: 45 },
};
export const completedPhone: PhoneCheckSnapshot = {
  stage: 'completed',
  busy: false,
  failure: null,
  pending: false,
  sent: false,
  challengeReserved: false,
  sendAgainAt: null,
  recordedAt: '2026-10-10T12:00:02Z',
  receipt: {
    challengeID: '00000000-0000-4000-8000-000000000002',
    sender: '12025550123',
    messageHash: 'a'.repeat(64),
    receivedAt: '2026-10-10T12:00:00Z',
    completedAt: '2026-10-10T12:00:01Z',
    subscriberFailure: null,
  },
};
