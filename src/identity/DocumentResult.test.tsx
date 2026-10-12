import type { DocumentCheckSnapshot } from '@kenshiki/identity-capture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, mockSession, property, required } from '../testing/support';
import { documentCustodyPresentation } from './DocumentCustodyPresentation';
import { DocumentResult } from './DocumentResult';
import { Action } from '../ui/Action';

jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
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
  const inspection = view.root.findByProps({ representation: 'original' });
  const portrait = view.root.findByProps({ representation: 'portrait' });
  expect(session.documentCheck).not.toHaveBeenCalled();
  const next = deferred();
  session.documentCheck.mockImplementationOnce(() => next.promise);
  await act(async () => {
    invoke(view.root.findByProps({ testID: 'check-document-record' }), 'onPress');
  });
  expect(view.root.findByProps({ testID: 'document-result' })).toBe(evidence);
  expect(view.root.findByProps({ representation: 'original' })).toBe(inspection);
  expect(view.root.findByProps({ representation: 'portrait' })).toBe(portrait);
  await act(async () => next.resolve(snapshot));
  expect(view.root.findByProps({ representation: 'original' })).toBe(inspection);
  expect(view.root.findByProps({ representation: 'portrait' })).toBe(portrait);
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

test('safe status preserves native details and image inspection without returning personal values to the readout', async () => {
  const f = fixture();
  const nativeDetails = jest.fn(async () => {});
  f.result.session.documentDetails = nativeDetails;
  const contaminated = {
    ...f.result,
    document: {
      ...f.result.document,
      back: {
        ...f.result.document.front,
        side: 'back' as const,
        captureID: 'back',
        pdf417Status: 'readable' as const,
        pdf417: { fields: { DBB: '01021990', DAK: '97001' } },
      },
    },
  };
  await act(async () => {
    view = create(<DocumentResult result={contaminated} configured />);
  });
  await act(async () =>
    f.pending.resolve({
      ...snapshot,
      state: 'checked',
      result: { outcome: 'unavailable', operationID: 'synthetic', replayed: false },
    }),
  );
  const text = JSON.stringify(view.toJSON());
  expect(text).toContain('Barcode detected');
  expect(text).toContain('License details');
  for (const pii of ['01021990', '97001']) expect(text).not.toContain(pii);
  expect(nativeDetails).not.toHaveBeenCalled();
  await act(async () => {
    invoke(view.root.findByProps({ testID: 'document-native-details' }), 'onPress');
  });
  expect(nativeDetails.mock.calls).toEqual([[documentCustodyPresentation()]]);
  expect(f.session.documentCheck).not.toHaveBeenCalled();
  expect(view.root.findByProps({ representation: 'original' })).toBeDefined();
});

test('saved results keep native detail access and images before retake and deletion', async () => {
  const f = fixture();
  const retake = jest.fn();
  const remove = jest.fn();
  await act(async () => {
    view = create(<DocumentResult result={f.result} configured onRetake={retake} onDelete={remove} />);
  });
  expect(view.root.findAllByType(Action)).toHaveLength(0);
  await act(async () =>
    f.pending.resolve({
      ...snapshot,
      state: 'checked',
      result: { outcome: 'recordMatched', operationID: 'saved-operation', replayed: true },
    }),
  );
  const rendered = JSON.stringify(view.toJSON());
  for (const marker of [
    'document-native-details',
    'document-result',
    'retake-saved-document',
    'delete-saved-document',
  ])
    expect(rendered).toContain(marker);
  for (const marker of ['document-native-details', 'document-result'])
    expect(rendered.indexOf(marker)).toBeLessThan(rendered.indexOf('retake-saved-document'));
  expect(rendered.indexOf('retake-saved-document')).toBeLessThan(rendered.indexOf('delete-saved-document'));
  const actions = view.root.findAllByType(Action);
  expect(actions.filter((node) => property(node, 'testID') === 'document-check-retake')).toHaveLength(0);
  for (const id of ['retake-saved-document', 'delete-saved-document'])
    await act(async () => {
      invoke(required(actions.find((node) => property(node, 'testID') === id)), 'onPress');
    });
  expect(retake).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(f.session.documentCheck).not.toHaveBeenCalled();
});

test('unreadable saved document has exactly one retake action and retains deletion after evidence', async () => {
  const f = fixture();
  const retake = jest.fn();
  const remove = jest.fn();
  await act(async () => {
    view = create(<DocumentResult result={f.result} configured onRetake={retake} onDelete={remove} />);
  });
  await act(async () => f.pending.resolve({ ...snapshot, state: 'unreadable' }));
  const actions = view.root.findAllByType(Action);
  const retakes = actions.filter((node) =>
    ['document-check-retake', 'retake-saved-document'].includes(String(property(node, 'testID'))),
  );
  expect(retakes).toHaveLength(1);
  expect(property(required(retakes[0]), 'testID')).toBe('document-check-retake');
  const rendered = JSON.stringify(view.toJSON());
  expect(rendered.indexOf('document-result')).toBeLessThan(rendered.indexOf('delete-saved-document'));
  expect(view.root.findByProps({ representation: 'original' })).toBeDefined();
  await act(async () => {
    invoke(required(retakes[0]), 'onPress');
  });
  expect(retake).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
  expect(f.session.documentCheck).not.toHaveBeenCalled();
});

test('native detail presentation is single-flight and failures expose only a safe retry message', async () => {
  const f = fixture();
  let reject!: (reason: Error) => void;
  const nativeDetails = jest.fn(
    () =>
      new Promise<void>((_resolve, no) => {
        reject = no;
      }),
  );
  f.result.session.documentDetails = nativeDetails;
  await act(async () => {
    view = create(<DocumentResult result={f.result} configured={false} />);
  });
  const action = () =>
    required(
      view.root.findAllByType(Action).find((node) => property(node, 'testID') === 'document-native-details'),
    );
  const button = () =>
    required(
      view.root
        .findAllByProps({ testID: 'document-native-details' })
        .filter((node) => typeof property(node, 'onPress') === 'function')
        .at(-1),
    );
  await act(async () => {
    invoke(button(), 'onPress');
    invoke(button(), 'onPress');
  });
  expect(nativeDetails).toHaveBeenCalledTimes(1);
  expect(property(action(), 'disabled')).toBe(true);
  await act(async () => {
    reject(new Error('PRIVATE-HOLDER-ADDRESS'));
  });
  expect(property(action(), 'disabled')).toBe(false);
  expect(JSON.stringify(view.toJSON())).not.toContain('PRIVATE-HOLDER-ADDRESS');
  expect(view.root.findAllByProps({ accessibilityRole: 'alert' }).length).toBeGreaterThan(0);
  nativeDetails.mockImplementationOnce(async () => {});
  await act(async () => {
    await invoke(button(), 'onPress');
  });
  expect(nativeDetails).toHaveBeenCalledTimes(2);
  expect(f.session.documentCheck).not.toHaveBeenCalled();
});
