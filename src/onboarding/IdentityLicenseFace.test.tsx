import type { CaptureEvent, DocumentFaceSnapshot } from '@kenshiki/identity-capture';
import { IdentityCapturePreview } from '@kenshiki/identity-capture';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, mockSession, property, required, settle } from '../testing/support';
import type { SavedDocumentCapture } from '../identity/DocumentFlowController';
import { IdentityLicenseFace } from './IdentityLicenseFace';
import { ControllerCustodyContext, createControllerCustody } from '../ui/ControllerCustody';
import { Page } from '../ui/Page';

jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCapturePreview: 'NativePreview',
  IdentitySymbol: 'NativeSymbol',
}));
const initial: DocumentFaceSnapshot = {
  state: 'notStarted',
  captureID: 'front',
  sourceSHA256: 'a'.repeat(64),
  documentOperationID: 'checked-operation',
  result: null,
};
const completed: DocumentFaceSnapshot = {
  ...initial,
  state: 'completed',
  result: { outcome: 'pass', completedAt: '2026-10-11T12:00:00Z' },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function fixture(snapshot: DocumentFaceSnapshot = initial) {
  let listener: ((event: CaptureEvent) => void) | undefined;
  const off = jest.fn();
  const native = mockSession({
    subscribe: jest.fn((receive: (event: CaptureEvent) => void) => {
      listener = receive;
      return off;
    }),
    documentFaceSnapshot: jest.fn(async (): Promise<DocumentFaceSnapshot> => snapshot),
    documentFacePrepare: jest.fn(async (): Promise<DocumentFaceSnapshot> => initial),
    documentFaceCompare: jest.fn(async (): Promise<DocumentFaceSnapshot> => completed),
    documentFaceRetrySave: jest.fn(async (): Promise<DocumentFaceSnapshot> => completed),
    startSelfie: jest.fn(async () => {}),
    captureSelfie: jest.fn(async () => {}),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
  const saved: SavedDocumentCapture = {
    session: native,
    document: {
      workflowID: 'license',
      front: {
        captureID: initial.captureID,
        sha256: initial.sourceSHA256,
        side: 'front',
        pdf417Status: 'notRequested',
        sideCorrespondence: null,
      },
      back: {
        captureID: 'back',
        sha256: 'b'.repeat(64),
        side: 'back',
        pdf417Status: 'readable',
        sideCorrespondence: null,
      },
    },
  };

  const custody = createControllerCustody();
  const complete = jest.fn();
  const exit = jest.fn();
  const claim = jest.fn();
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <ControllerCustodyContext.Provider value={custody}>
        <IdentityLicenseFace
          saved={saved}
          documentOperationID={initial.documentOperationID}
          onClaim={claim}
          onComplete={complete}
          onExit={exit}
        />
      </ControllerCustodyContext.Provider>,
    );
  });
  const emit = async (event: CaptureEvent) => {
    await act(async () => {
      required(listener)(event);
      await settle();
    });
  };
  const press = async (id: string) => {
    await act(async () => {
      await invoke(view.root.findByProps({ testID: id }), 'onPress');
      await settle();
    });
  };
  const unmount = async () => {
    await act(async () => {
      view.unmount();
      await settle();
    });
  };
  return { native, saved, view, custody, complete, exit, claim, emit, press, unmount };
}
afterEach(() => jest.restoreAllMocks());

test('face preparation is passive; explicit start uses native preview and capture waits for readiness', async () => {
  const f = await fixture();
  expect(f.claim).toHaveBeenCalledTimes(1);
  expect(f.native.documentFacePrepare).not.toHaveBeenCalled();
  expect(f.native.startSelfie).not.toHaveBeenCalled();
  expect(f.view.root.findAllByType(IdentityCapturePreview)).toHaveLength(0);
  await f.press('onboarding-face-start');
  const preview = f.view.root.findByType(IdentityCapturePreview);
  expect(property(preview, 'session')).toBe(f.native);
  expect(property(preview, 'kind')).toBe('selfie');
  expect(property(f.view.root.findByProps({ testID: 'onboarding-face-capture' }), 'disabled')).toBe(true);
  await f.emit({ type: 'selfieReadiness', permitsCapture: true, reason: null, blinkPhase: 'reopened' });
  expect(property(f.view.root.findByProps({ testID: 'onboarding-face-capture' }), 'disabled')).toBe(false);
  await f.press('onboarding-face-capture');
  expect(f.native.captureSelfie).toHaveBeenCalledTimes(1);
  await f.emit({ type: 'documentSelfieCaptured' });
  expect(f.native.documentFaceCompare).toHaveBeenCalledTimes(1);
  expect(f.view.root.findByProps({ testID: 'onboarding-face-pass' })).toBeDefined();
  expect(JSON.stringify(f.view.toJSON())).not.toContain('PRIVATE-');
  expect(f.complete).not.toHaveBeenCalled();
  await f.unmount();
  expect(f.native.release).toHaveBeenCalledTimes(1);
});

test.each(['pass', 'fail', 'manual_review'] as const)(
  'native %s remains on the face result without advancing',
  async (outcome) => {
    const f = await fixture({
      ...completed,
      state: 'completed',
      result: { outcome, completedAt: '2026-10-11T12:00:00Z' },
    });
    expect(f.view.root.findByProps({ testID: `onboarding-face-${outcome}` })).toBeDefined();
    if (outcome !== 'pass')
      expect(f.view.root.findAllByProps({ testID: 'onboarding-face-pass' })).toHaveLength(0);
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.exit).not.toHaveBeenCalled();
    expect(f.native.documentFacePrepare).not.toHaveBeenCalled();
    expect(f.native.startSelfie).not.toHaveBeenCalled();
    await f.unmount();
  },
);

test('a stale native document operation shows failure and never a passed result or camera', async () => {
  const f = await fixture({ ...completed, documentOperationID: 'old-operation' });
  expect(f.view.root.findAllByProps({ testID: 'onboarding-face-failure' }).length).toBeGreaterThan(0);
  expect(f.view.root.findAllByProps({ testID: 'onboarding-face-pass' })).toHaveLength(0);
  expect(f.native.startSelfie).not.toHaveBeenCalled();
  await f.unmount();
});

test('native save failure retries saving without another capture or comparison', async () => {
  const f = await fixture();
  f.native.documentFaceCompare.mockRejectedValueOnce({ code: 'resultSaveFailed', detail: 'PRIVATE ERROR' });
  await f.press('onboarding-face-start');
  await f.emit({ type: 'documentSelfieCaptured' });
  expect(JSON.stringify(f.view.toJSON())).not.toContain('PRIVATE ERROR');
  expect(f.view.root.findAllByType(IdentityCapturePreview)).toHaveLength(0);
  await f.press('onboarding-face-save');
  expect(f.native.documentFaceRetrySave).toHaveBeenCalledTimes(1);
  expect(f.native.documentFaceCompare).toHaveBeenCalledTimes(1);
  expect(f.native.documentFacePrepare).toHaveBeenCalledTimes(1);
  expect(f.view.root.findByProps({ testID: 'onboarding-face-pass' })).toBeDefined();
  await f.unmount();
});

test.each([false, true])(
  'Back waits for native settlement and fences late unmount: %s',
  async (unmountFirst) => {
    const f = await fixture();
    const pending = deferred<void>();
    f.native.cancel.mockReturnValueOnce(pending.promise);
    let closing: unknown;
    await act(async () => {
      closing = invoke(f.view.root.findByType(Page), 'onClose');
      invoke(f.view.root.findByType(Page), 'onClose');
      await settle();
    });
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.native.cancel).toHaveBeenCalledTimes(1);
    if (unmountFirst) await f.unmount();
    await act(async () => {
      pending.resolve();
      await closing;
      await settle();
    });
    expect(f.complete).toHaveBeenCalledTimes(unmountFirst ? 0 : 1);
    expect(f.exit).not.toHaveBeenCalled();
    if (!unmountFirst) {
      expect(f.complete).toHaveBeenCalledWith({ ...f.saved, snapshot: initial });
      await f.unmount();
    }
    await f.custody.releasing;
    expect(f.native.release).toHaveBeenCalledTimes(unmountFirst ? 1 : 0);
  },
);

test('failed Back keeps custody and permits another explicit close', async () => {
  const f = await fixture();
  f.native.cancel.mockRejectedValueOnce({ code: 'operationFailed' });
  await act(async () => {
    await invoke(f.view.root.findByType(Page), 'onClose');
  });
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.native.release).not.toHaveBeenCalled();
  expect(f.view.root.findAllByProps({ testID: 'onboarding-face-failure' }).length).toBeGreaterThan(0);
  await act(async () => {
    await invoke(f.view.root.findByType(Page), 'onClose');
  });
  expect(f.complete).toHaveBeenCalledTimes(1);
  await f.unmount();
  expect(f.native.release).not.toHaveBeenCalled();
});

test('background settles camera; foreground never restarts capture automatically', async () => {
  let change: ((value: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_kind, listener) => {
    change = listener;
    return { remove };
  });
  const f = await fixture();
  await f.press('onboarding-face-start');
  await act(async () => {
    change?.('background');
    await settle();
  });
  expect(f.native.cancel).toHaveBeenCalledTimes(1);
  expect(f.view.root.findAllByType(IdentityCapturePreview)).toHaveLength(0);
  await act(async () => {
    change?.('active');
    await settle();
  });
  expect(f.native.startSelfie).toHaveBeenCalledTimes(1);
  expect(f.native.documentFaceCompare).not.toHaveBeenCalled();
  await f.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
