import type { DocumentCheckSnapshot } from '@kenshiki/identity-capture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, mockSession, required } from './__tests__/support';
import { DocumentResult } from './DocumentResult';

jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('../../ReactNative/identity-capture/src/codes')>(
    '../../ReactNative/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityDocumentInspection: 'Inspection',
}));
const snapshot: DocumentCheckSnapshot = {
  captureID: 'front',
  sourceSHA256: 'digest',
  state: 'notStarted',
  result: null,
  checkedAt: null,
  failure: null,
};
function deferred() {
  let resolve!: (value: DocumentCheckSnapshot) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<DocumentCheckSnapshot>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const pending = deferred();
  const session = mockSession({
    documentCheckRestore: jest.fn(() => pending.promise),
    documentCheck: jest.fn(async () => snapshot),
  });
  const result = {
    session,
    document: {
      workflowID: 'workflow',
      front: {
        captureID: 'front',
        sha256: 'digest',
        side: 'front' as const,
        pdf417: null,
        pdf417Status: 'notRequested' as const,
        sideCorrespondence: null,
      },
      back: null,
    },
  };
  return { pending, session, result };
}
let view: ReactTestRenderer;
afterEach(async () => {
  await act(async () => view?.unmount());
});

test('local restoration reveals status and evidence together without a provider call; later actions retain evidence', async () => {
  const { result, pending, session } = fixture();
  await act(async () => {
    view = create(<DocumentResult result={result} configured />);
  });
  expect(view.root.findAllByProps({ testID: 'document-result-loading' }).length).toBeGreaterThan(0);
  expect(view.root.findAllByProps({ testID: 'document-result' })).toHaveLength(0);
  expect(view.root.findAllByProps({ testID: 'document-check-panel' })).toHaveLength(0);
  await act(async () => pending.resolve(snapshot));
  expect(view.root.findAllByProps({ testID: 'document-result-loading' })).toHaveLength(0);
  const evidence = view.root.findByProps({ testID: 'document-result' });
  expect(session.documentCheck).not.toHaveBeenCalled();
  const next = deferred();
  session.documentCheck.mockImplementationOnce(() => next.promise);
  await act(async () => {
    invoke(view.root.findByProps({ testID: 'check-document-record' }), 'onPress');
  });
  expect(view.root.findByProps({ testID: 'document-result' })).toBe(evidence);
  await act(async () => next.resolve(snapshot));
});

test('restore rejection ends loading and preserves saved evidence and recovery', async () => {
  const { result, pending } = fixture();
  await act(async () => {
    view = create(<DocumentResult result={result} configured />);
  });
  await act(async () => pending.reject(new Error('synthetic restore failure')));
  expect(view.root.findAllByProps({ testID: 'document-result-loading' })).toHaveLength(0);
  expect(view.root.findByProps({ testID: 'document-result' })).toBeDefined();
  expect(view.root.findByProps({ testID: 'document-check-recover' })).toBeDefined();
});

test('unconfigured checks do not prevent local evidence or start restoration', async () => {
  const { result, session } = fixture();
  await act(async () => {
    view = create(<DocumentResult result={result} configured={false} />);
  });
  expect(view.root.findByProps({ testID: 'document-result' })).toBeDefined();
  expect(session.documentCheckRestore).not.toHaveBeenCalled();
});

test('replacement capture rejects a late restore from the previously selected document', async () => {
  const first = fixture();
  const next = fixture();
  next.result.document.front.captureID = 'replacement';
  await act(async () => {
    view = create(<DocumentResult result={first.result} configured />);
  });
  await act(async () => {
    view.update(<DocumentResult result={next.result} configured />);
  });
  await act(async () => first.pending.resolve(snapshot));
  expect(view.root.findAllByProps({ testID: 'document-result' })).toHaveLength(0);
  await act(async () => next.pending.resolve({ ...snapshot, captureID: 'replacement' }));
  expect(view.root.findByProps({ testID: 'document-result' })).toBeDefined();
  expect(required(next.session.documentCheckRestore.mock.calls)).toHaveLength(1);
});
