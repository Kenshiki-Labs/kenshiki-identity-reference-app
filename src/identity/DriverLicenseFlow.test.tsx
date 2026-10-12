import type {
  CaptureEvent,
  Configuration,
  DocumentCheckSnapshot,
  DocumentObservation,
  DocumentRecordSummary,
} from '@kenshiki/identity-capture';
import { Modal } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { documentConfiguration } from '../testing/documentFixture';
import { invoke, nativeBack, property, required } from '../testing/support';
import App from '../app/App';
import { documentCustodyPresentation } from './DocumentCustodyPresentation';
import { DriverLicenseFlow } from './DriverLicenseFlow';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { Page } from '../ui/Page';

let mockEvent: (event: CaptureEvent) => void;
let mockSnapshot: DocumentObservation | undefined;
const mockFront: DocumentObservation = {
  workflowID: 'first',
  front: {
    captureID: 'front',
    sha256: 'front-digest',
    side: 'front',

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
  },
};
const mockSession = {
  id: 'doc',
  subscribe: jest.fn((listener: (event: CaptureEvent) => void) => {
    mockEvent = listener;
    return jest.fn();
  }),
  restoreDocumentSelection: jest.fn(async () => null),
  documentCheck: jest.fn(async (_consent: true): Promise<DocumentCheckSnapshot> => matchedCheck),
  documentCheckAskAgain: jest.fn(async (_consent: true): Promise<DocumentCheckSnapshot> => matchedCheck),
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
  documentDetails: jest.fn(async () => {}),
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
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
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
      if (id === 'native-back') {
        await nativeBack(view);
        return;
      }
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

test('license capture returns to its detail route and both exact photos and read details reopen without another camera run', async () => {
  const { view, tap, capture } = await renderApp();
  await tap('open-driver-license');
  await tap('start-license-capture');
  await tap('start-document-front');
  await capture(mockFront);
  expect(JSON.stringify(view.toJSON())).toContain('Turn the card over');
  await tap('start-document-back');
  await capture(mockComplete);
  expect(view.root.findByProps({ testID: 'document-native-details' })).toBeDefined();
  expect(mockSession.documentDetails).not.toHaveBeenCalled();
  await tap('document-native-details');
  expect(mockSession.documentDetails.mock.calls).toEqual([[documentCustodyPresentation()]]);
  expect(JSON.stringify(view.toJSON()).indexOf('document-check-panel')).toBeLessThan(
    JSON.stringify(view.toJSON()).indexOf('document-result'),
  );
  expect(JSON.stringify(view.toJSON())).not.toContain('Verified');
  expect(view.root.findAllByProps({ testID: 'finish-document' })).toHaveLength(0);
  await tap('native-back');
  expect(view.root.findByProps({ testID: 'face-match-card' })).toBeDefined();
  expect(mockSession.release).not.toHaveBeenCalled();
  await tap('open-driver-license');
  expect(view.root.findByProps({ testID: 'document-result' })).toBeDefined();
  expect(JSON.stringify(view.toJSON()).indexOf('document-check-panel')).toBeLessThan(
    JSON.stringify(view.toJSON()).indexOf('document-result'),
  );
  const front = view.root.find(
    (node) => String(node.type) === 'MockDocumentInspection' && node.props.representation === 'original',
  );
  expect([property(front, 'side'), property(front, 'representation'), property(front, 'sha256')]).toEqual([
    'front',
    'original',
    'front-digest',
  ]);
  await tap('inspect-back');
  const back = view.root.find(
    (node) => String(node.type) === 'MockDocumentInspection' && node.props.representation === 'original',
  );
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
  await tap('start-license-capture');
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
  await tap('start-license-capture');
  const choices = view.root.findByProps({ testID: 'saved-documents-list' });
  expect(choices.findAllByType(Action)).toHaveLength(3);
  for (const choice of choices.findAllByType(Action)) expect(property(choice, 'grouped')).toBe(true);
  expect(mockSession.recoverDocument).not.toHaveBeenCalled();
  await tap('saved-document-0');
  expect(mockSession.recoverDocument).toHaveBeenCalledWith('back');
  expect(view.root.findByProps({ testID: 'document-result' })).toBeDefined();
  expect(mockSession.startDocument).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});

test('closing before a front capture exposes failed release without returning or reopening custody', async () => {
  let rejectRelease!: (error: Error) => void;
  mockSession.release.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectRelease = reject;
      }),
  );
  const exit = jest.fn();
  const complete = jest.fn();
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<DriverLicenseFlow configuration={{}} onComplete={complete} onExit={exit} />);
  });
  const close = () => Promise.resolve(invoke(view.root.findByType(Page), 'onClose'));
  let closing!: Promise<unknown>;
  await act(async () => {
    closing = close();
  });
  expect(mockSession.release).toHaveBeenCalledTimes(1);
  expect(exit).not.toHaveBeenCalled();
  await act(async () => {
    rejectRelease(new Error('private native release detail'));
    await closing;
  });
  expect(view.root.findAllByProps({ testID: 'document-release-failure' }).length).toBeGreaterThan(0);
  const rendered = JSON.stringify(view.toJSON());
  expect(rendered).toContain(t('common.sessionRecovery'));
  expect(rendered).not.toContain('private native release detail');
  expect(property(view.root.findByType(Page), 'covered')).toBe(true);
  expect(property(view.root.findByType(Modal), 'onRequestClose')).toBeUndefined();
  expect(view.root.findAllByProps({ testID: 'document-release-failure' }).length).toBeGreaterThan(0);
  // Repeated close cannot retry release or navigate after failed settlement.
  await act(async () => {
    await close();
  });
  expect(exit).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  expect(mockSession.startDocument).not.toHaveBeenCalled();
  expect(mockSession.release).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.unmount();
  });
  expect(mockSession.release).toHaveBeenCalledTimes(1);
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
  await tap('start-license-capture');
  await tap('start-document-front');
  await capture(mockFront);
  await tap('start-document-back');
  await capture(mockComplete);
  expect(view.root.findAllByProps({ testID: 'finish-document' })).toHaveLength(0);
  await tap('native-back');
  const home = view.root.findByProps({ testID: 'open-driver-license' });
  expect(home.findAll((node) => node.props.children === t(key)).length).toBeGreaterThan(0);
  expect(mockSession.documentCheckRestore).toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});

async function openGuidedLicense(app: Awaited<ReturnType<typeof renderApp>>) {
  await app.tap('open-identity-welcome');
  await app.tap('onboarding-start');
  await app.tap('choose-license');
  await app.tap('onboarding-continue');
}

test('guided preparation explicitly starts one existing capture owner, then checks only on consent', async () => {
  const app = await renderApp({ document: documentConfiguration });
  await openGuidedLicense(app);
  expect(mockSession.startDocument).not.toHaveBeenCalled();
  expect(mockSession.documentCheck).not.toHaveBeenCalled();
  const start = app.view.root
    .findAllByType(Action)
    .find((node) => property(node, 'testID') === 'onboarding-capture');
  await act(async () => {
    invoke(required(start), 'onPress');
    invoke(required(start), 'onPress');
  });
  expect(mockSession.startDocument.mock.calls).toEqual([[{ consent: true, side: 'front' }]]);
  await app.capture(mockFront);
  await app.tap('start-document-back');
  await app.capture(mockComplete);
  expect(app.view.root.findAllByProps({ testID: 'onboarding-license-review' }).length).toBeGreaterThan(0);
  expect(mockSession.documentCheck).not.toHaveBeenCalled();
  expect(app.view.root.findAllByProps({ testID: 'onboarding-license-accepted' })).toHaveLength(0);
  await app.tap('check-document-record');
  expect(mockSession.documentCheck.mock.calls).toEqual([[true]]);
  expect(app.view.root.findAllByProps({ testID: 'onboarding-license-accepted' }).length).toBeGreaterThan(0);
  await app.tap('modal-cancel');
  expect(app.view.root.findAllByProps({ testID: 'identity-preparation' }).length).toBeGreaterThan(0);
  expect(app.view.root.findAllByProps({ testID: 'onboarding-license-review' })).toHaveLength(0);
  await act(async () => app.view.unmount());
});

test('guided front-only cancellation returns to preparation and resumes the same native draft', async () => {
  const app = await renderApp({ document: documentConfiguration });
  await openGuidedLicense(app);
  await app.tap('onboarding-capture');
  await app.capture(mockFront);
  await app.tap('modal-cancel');
  expect(app.view.root.findAllByProps({ testID: 'identity-preparation' }).length).toBeGreaterThan(0);
  expect(app.view.root.findAllByProps({ testID: 'onboarding-license-review' })).toHaveLength(0);
  expect(mockSession.documentCheck).not.toHaveBeenCalled();
  await app.tap('onboarding-capture');
  expect(mockSession.startDocument.mock.calls).toEqual([
    [{ consent: true, side: 'front' }],
    [{ consent: true, side: 'back' }],
  ]);
  await app.capture(mockComplete);
  expect(app.view.root.findAllByProps({ testID: 'onboarding-license-review' }).length).toBeGreaterThan(0);
  await act(async () => app.view.unmount());
});

test('guided failed capture settlement stays in recovery without mounting a check owner', async () => {
  const app = await renderApp({ document: documentConfiguration });
  await openGuidedLicense(app);
  await app.tap('onboarding-capture');
  await app.capture(mockFront);
  await app.tap('start-document-back');
  mockSession.documentResult.mockRejectedValueOnce({ code: 'documentIntegrityFailure' });
  const checks = mockSession.documentCheckRestore.mock.calls.length;
  await app.capture(mockComplete);
  expect(app.view.root.findAllByProps({ testID: 'document-bottom-sheet' }).length).toBeGreaterThan(0);
  expect(app.view.root.findAllByProps({ testID: 'onboarding-license-review' })).toHaveLength(0);
  expect(mockSession.documentCheckRestore).toHaveBeenCalledTimes(checks);
  expect(mockSession.documentCheck).not.toHaveBeenCalled();
  await act(async () => app.view.unmount());
});
