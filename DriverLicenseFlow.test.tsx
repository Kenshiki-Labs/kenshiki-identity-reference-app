import type { CaptureEvent, DocumentObservation, DocumentRecordSummary } from '@kenshiki/identity-capture';
import renderer, { act } from 'react-test-renderer';
import { invoke, property, required } from './__tests__/support';
import App from './App';

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
};
jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('../../ReactNative/identity-capture/src/codes')>(
    '../../ReactNative/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCaptureSession: { create: jest.fn(async () => mockSession) },
  IdentityCapturePreview: 'MockCapturePreview',
  IdentityCaptureImage: 'MockCaptureImage',
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockSnapshot = undefined;
});
async function renderApp() {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<App />);
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
  expect(JSON.stringify(view.toJSON())).not.toContain('Verified');
  await tap('finish-document');
  expect(view.root.findByProps({ testID: 'face-match-card' })).toBeDefined();
  expect(mockSession.release).not.toHaveBeenCalled();
  await tap('open-driver-license');
  expect(view.root.findByProps({ testID: 'document-result' })).toBeDefined();
  const images = view.root.findAll((node) => String(node.type) === 'MockCaptureImage');
  expect(images.map((image) => [property(image, 'image'), property(image, 'sha256')])).toEqual([
    ['documentFront', 'front-digest'],
    ['documentBack', 'back-digest'],
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
