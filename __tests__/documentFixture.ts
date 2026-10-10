import type { Configuration, DocumentCheckSnapshot, DocumentObservation } from '@kenshiki/identity-capture';

export const documentConfiguration: NonNullable<Configuration['document']> = {
  directoryURL: 'file:///synthetic/documents',
  keychainService: 'synthetic-documents',
  keychainAccount: 'evidence',
  requiresLocation: false,
  check: { providerID: 'synthetic-document', recordDomain: 'synthetic' },
};
const front = {
  captureID: 'synthetic-front',
  sha256: 'a'.repeat(64),
  side: 'front' as const,
  pdf417: null,
  pdf417Status: 'notRequested' as const,
  sideCorrespondence: null,
};
const back = { ...front, captureID: 'synthetic-back', side: 'back' as const };
const document: DocumentObservation = { workflowID: 'synthetic-document', front, back };
const checked: DocumentCheckSnapshot = {
  captureID: front.captureID,
  sourceSHA256: front.sha256,
  state: 'checked',
  failure: null,
  checkedAt: '2026-10-10T12:00:00Z',
  result: {
    outcome: 'recordMatched',
    operationID: '00000000-0000-4000-8000-000000000003',
    providerChecks: [],
    correctable: [],
    replayed: false,
  },
};

/** These native answers let UI journeys satisfy the same document prerequisite as a device. */
export function documentSessionMethods() {
  return {
    listDocuments: jest.fn(async () => [
      { workflowID: document.workflowID, ...front },
      { workflowID: document.workflowID, ...back },
    ]),
    recoverDocument: jest.fn(async () => document),
    documentResult: jest.fn(async () => document),
    documentCheckRestore: jest.fn(async () => checked),
  };
}
