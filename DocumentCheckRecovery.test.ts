import type { DocumentCheckSnapshot } from '@kenshiki/identity-capture';
import { documentCheckAction } from './DocumentCheckRecovery';

const saved: DocumentCheckSnapshot = {
  captureID: 'synthetic-capture',
  sourceSHA256: 'synthetic-digest',
  state: 'notStarted',
  result: null,
  checkedAt: null,
  failure: null,
};

test.each([
  'serviceUnavailable',
  'replyRejected',
  'custodyUnavailable',
  'cancelled',
  'requestRejected',
] as const)('%s does not infer whether a request exists or authorize a fresh dispatch', (failure) => {
  expect(documentCheckAction({ ...saved, state: 'unavailable', failure })).toBe('restore');
});
test.each([
  'missingPreparedDocument',
  'engineUnavailable',
  'analysisNotCompleted',
  'retentionFailed',
] as const)(
  '%s allows the native preparer and reader to recover without requiring a new photograph',
  (failure) => {
    expect(documentCheckAction({ ...saved, state: 'readerUnavailable', failure })).toBe('readAgain');
  },
);
test.each(['sourceIntegrityFailure', 'authenticityFailed', 'documentNotLive'] as const)(
  '%s requires a new capture rather than reprocessing rejected evidence',
  (failure) => {
    expect(documentCheckAction({ ...saved, state: 'readerUnavailable', failure })).toBe('retake');
  },
);
test('an undecodable capture and non-camera original require retake', () => {
  expect(documentCheckAction({ ...saved, state: 'unreadable' })).toBe('retake');
  expect(documentCheckAction({ ...saved, state: 'unavailable', failure: 'notCameraCapture' })).toBe('retake');
});
