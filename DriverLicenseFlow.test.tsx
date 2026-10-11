import type {
  CaptureEvent,
  Configuration,
  DocumentCheckSnapshot,
  DocumentObservation,
  DocumentRecordSummary,
} from '@kenshiki/identity-capture';
import renderer, { act } from 'react-test-renderer';
import { documentConfiguration } from './__tests__/documentFixture';
import { invoke, property, required } from './__tests__/support';
import App from './App';
import { t } from './locales/i18n';

let mockEvent: (event: CaptureEvent) => void;
let mockSnapshot: DocumentObservation | undefined;
const mockFront: DocumentObservation = {
  workflowID: 'first',
  front: {
    captureID: 'front',
    sha256: 'front-digest',
    side: 'front',
    pdf417: null,
    pdf417Status: 'notRequested',
    sideCorrespondence: null,
  },
  back: null,
};
const mockComplete: DocumentObservation = {
  ...mockFront,
  back: {
    captureID: 'back',
    sha256: 'back-digest',
    side: 'back',
    pdf417Status: 'readable',
    sideCorrespondence: { jurisdiction: 'matches', documentNumber: 'found', frontReading: 'read' },
    pdf417: {
      status: 'readable',
      fields: { DAC: 'SYNTHETIC', DCS: 'SPECIMEN', DAQ: 'TEST123', DAG: '123 SAMPLE ST' },
      version: 10,
      issuerIIN: '636000',
      jurisdictionVersion: 0,
      missingRequiredElements: [],
    },
  },
};
const mockSession = {
  id: 'doc',
  subscribe: jest.fn((listener: (event: CaptureEvent) => void) => {
    mockEvent = listener;
    return jest.fn();
  }),
  listDocuments: jest.fn(async (): Promise<DocumentRecordSummary[]> => []),
  recoverDocument: jest.fn(async (_captureID: string) => {
    mockSnapshot = mockComplete;
    return mockComplete;
  }),
  startDocument: jest.fn(async (_options: { consent: boolean; side: 'front' | 'back' }) => {}),
  captureDocument: jest.fn(async () => {}),
  documentResult: jest.fn(async () => {
    if (!mockSnapshot) throw { code: 'documentUnavailable' };
    return mockSnapshot;
  }),
  cancel: jest.fn(async () => {}),
  release: jest.fn(async () => {}),
  eraseDocuments: jest.fn(async () => {}),
  documentCheckRestore: jest.fn(
    async (): Promise<DocumentCheckSnapshot> => ({
      captureID: 'front',
      sourceSHA256: 'front-digest',
      state: 'notStarted',
      failure: null,
      checkedAt: null,
      result: null,
    }),
  ),
};
jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('../../ReactNative/identity-capture/src/codes')>(
    '../../ReactNative/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCaptureSession: { create: jest.fn(async () => mockSession) },
  IdentityCapturePreview: 'MockCapturePreview',
  IdentityCaptureImage: 'MockCaptureImage',
  IdentityDocumentInspection: 'MockDocumentInspection',
  IdentitySymbol: 'MockSymbol',
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockSnapshot = undefined;
});
async function renderApp(configuration?: Configuration) {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<App configuration={configuration} />);
  });
  async function tap(id: string) {
    await act(async () => {
      const button = required(
        view.root
          .findAllByProps({ testID: id })
          .filter((node) => typeof node.props.onPress === 'function')
          .at(-1),
      );
      await invoke(button, 'onPress');
    });
  }
  async function capture(observation: DocumentObservation) {
    await act(async () => {
      mockSnapshot = observation;
      mockEvent({ type: 'documentCaptured', observation });
    });
  }
  return { view, tap, capture };
}

test('license capture returns to Identity and both exact photos and read details reopen without another camera run', async () => {
  const { view, tap, capture } = await renderApp();
  await tap('open-driver-license');
  await tap('start-document-front');
  await capture(mockFront);
  expect(JSON.stringify(view.toJSON())).toContain('Turn the card over');
  await tap('start-document-back');
  await capture(mockComplete);
  expect(JSON.stringify(view.toJSON())).toContain('SYNTHETIC SPECIMEN');
  expect(JSON.stringify(view.toJSON())).toContain('123 SAMPLE ST');
  expect(JSON.stringify(view.toJSON()).indexOf('document-check-panel')).toBeLessThan(
    JSON.stringify(view.toJSON()).indexOf('document-result'),
  );
  expect(JSON.stringify(view.toJSON())).not.toContain('Verified');
  await tap('finish-document');
  expect(view.root.findByProps({ testID: 'face-match-card' })).toBeDefined();
  expect(mockSession.release).not.toHaveBeenCalled();
  await tap('open-driver-license');
  expect(view.root.findByProps({ testID: 'document-result' })).toBeDefined();
  expect(JSON.stringify(view.toJSON()).indexOf('document-check-panel')).toBeLessThan(
    JSON.stringify(view.toJSON()).indexOf('document-result'),
  );
  const front = view.root.find((node) => String(node.type) === 'MockDocumentInspection');
  expect([property(front, 'side'), property(front, 'representation'), property(front, 'sha256')]).toEqual([
    'front',
    'original',
    'front-digest',
  ]);
  await tap('inspect-back');
  const back = view.root.find((node) => String(node.type) === 'MockDocumentInspection');
  expect([property(back, 'side'), property(back, 'representation'), property(back, 'sha256')]).toEqual([
    'back',
    'original',
    'back-digest',
  ]);
  expect(mockSession.startDocument).toHaveBeenCalledTimes(2);
  await act(async () => {
    view.unmount();
  });
  expect(mockSession.release).toHaveBeenCalledTimes(1);
});
test('permanent camera failure uses an app bottom sheet and returns to the same Identity home', async () => {
  mockSession.startDocument.mockRejectedValueOnce({ code: 'backCameraUnavailable' });
  const { view, tap } = await renderApp();
  await tap('open-driver-license');
  await tap('start-document-front');
  expect(view.root.findByProps({ testID: 'document-bottom-sheet' })).toBeDefined();
  expect(JSON.stringify(view.toJSON())).toContain('Camera unavailable');
  expect(view.root.findAllByProps({ testID: 'retry-document' })).toHaveLength(0);
  await tap('document-back-to-identity');
  expect(view.root.findByProps({ testID: 'open-driver-license' })).toBeDefined();
  expect(mockSession.release).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.unmount();
  });
});
test('multiple saved workflows show an explicit selector before recovering one', async () => {
  mockSession.listDocuments.mockResolvedValueOnce([
    { workflowID: 'first', ...required(mockFront.front) },
    { workflowID: 'first', ...required(mockComplete.back) },
    { workflowID: 'second', ...required(mockFront.front), captureID: 'other-front' },
  ]);
  const { view, tap } = await renderApp();
  await tap('open-driver-license');
  expect(view.root.findByProps({ testID: 'saved-documents-list' })).toBeDefined();
  expect(mockSession.recoverDocument).not.toHaveBeenCalled();
  await tap('saved-document-0');
  expect(mockSession.recoverDocument).toHaveBeenCalledWith('back');
  expect(view.root.findByProps({ testID: 'document-result' })).toBeDefined();
  expect(mockSession.startDocument).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});

const matchedCheck: DocumentCheckSnapshot = {
  captureID: 'front',
  sourceSHA256: 'front-digest',
  state: 'checked',
  failure: null,
  checkedAt: '2026-10-10T12:00:00Z',
  result: {
    operationID: '00000000-0000-4000-8000-000000000003',
    outcome: 'recordMatched',
    providerChecks: [],
    correctable: [],
    replayed: false,
  },
};
const homeStatuses = [
  {
    snapshot: { ...matchedCheck, state: 'notStarted' as const, result: null },
    key: 'hub.license.captured' as const,
  },
  { snapshot: matchedCheck, key: 'hub.license.recordMatched' as const },
  {
    snapshot: { ...matchedCheck, result: { ...required(matchedCheck.result), operationID: '' } },
    key: 'hub.license.checkNeedsAttention' as const,
  },
  { snapshot: { ...matchedCheck, captureID: 'another-front' }, key: 'hub.license.captured' as const },
  { snapshot: { ...matchedCheck, sourceSHA256: 'another-digest' }, key: 'hub.license.captured' as const },
  {
    snapshot: { ...matchedCheck, state: 'unanswered' as const, result: null },
    key: 'documentCheck.state.unanswered' as const,
  },
  {
    snapshot: {
      ...matchedCheck,
      state: 'readerUnavailable' as const,
      failure: 'missingPreparedDocument' as const,
      result: null,
    },
    key: 'hub.license.checkNeedsAttention' as const,
  },
  ...(['pending', 'needsCorrection', 'recordNotMatched'] as const).map((outcome) => ({
    snapshot: { ...matchedCheck, result: { ...required(matchedCheck.result), outcome } },
    key: `documentCheck.outcome.${outcome}` as const,
  })),
];
test.each(homeStatuses)('home reflects $key only for the selected capture', async ({ snapshot, key }) => {
  mockSession.documentCheckRestore.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(snapshot);
  const { view, tap, capture } = await renderApp({ document: documentConfiguration });
  await tap('open-driver-license');
  await tap('start-document-front');
  await capture(mockFront);
  await tap('start-document-back');
  await capture(mockComplete);
  await tap('finish-document');
  const home = view.root.findByProps({ testID: 'open-driver-license' });
  expect(home.findAll((node) => node.props.children === t(key)).length).toBeGreaterThan(0);
  expect(mockSession.documentCheckRestore).toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});
