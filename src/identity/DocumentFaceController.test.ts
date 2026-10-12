import type { CaptureEvent, DocumentFaceSnapshot, SelfieAdmissionReceipt } from '@kenshiki/identity-capture';
import { mockSession, required, settle } from '../testing/support';
import { DocumentFaceController } from './DocumentFaceController';
import type { SavedDocumentCapture } from './DocumentFlowController';

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
const receipt: SelfieAdmissionReceipt = {
  policyVersion: 'synthetic',
  frameTimestamp: 1,
  anchorID: 'PRIVATE-ANCHOR',
  blinkCompletedAt: 1,
  leftEyeClosed: 0,
  rightEyeClosed: 0,
  captureQualityEnforced: false,
  guideContainmentEnforced: false,
  trigger: 'automatic',
  eyesOpen: true,
  blinkAge: 0,
  consecutiveTrackedFrames: 10,
  steadyHoldDuration: 1,
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
function fixture() {
  let listener: ((event: CaptureEvent) => void) | undefined;
  const off = jest.fn();
  const native = mockSession({
    subscribe: jest.fn((receive: (event: CaptureEvent) => void) => {
      listener = receive;
      return off;
    }),
    documentFaceSnapshot: jest.fn(async (): Promise<DocumentFaceSnapshot> => initial),
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
  const changed = jest.fn();
  const controller = new DocumentFaceController(saved, changed, initial.documentOperationID);
  const emit = (event: CaptureEvent) => required(listener)(event);
  const ready = () =>
    emit({ type: 'selfieReadiness', permitsCapture: true, reason: null, blinkPhase: 'reopened' });
  const captured = () => emit({ type: 'documentSelfieCaptured' });
  return { controller, native, saved, changed, off, emit, ready, captured };
}

test('open restores status without preparing a reference, camera, comparison or passport acquisition', async () => {
  const f = fixture();
  await f.controller.open();
  expect(f.controller.state.snapshot).toEqual(initial);
  expect(f.native.documentFaceSnapshot).toHaveBeenCalledTimes(1);
  for (const method of [
    f.native.documentFacePrepare,
    f.native.startSelfie,
    f.native.documentFaceCompare,
    f.native.compareFace,
    f.native.readPassport,
    f.native.recoverPassport,
    f.native.setReference,
  ])
    expect(method).not.toHaveBeenCalled();
  await f.controller.dispose();
});
test('explicit start binds native license before camera; it passes consent only', async () => {
  const f = fixture();
  const pending = deferred<DocumentFaceSnapshot>();
  f.native.documentFacePrepare.mockReturnValueOnce(pending.promise);
  const start = f.controller.start();
  await settle();
  expect(f.native.documentFacePrepare).toHaveBeenCalledWith(true);
  expect(f.native.startSelfie).not.toHaveBeenCalled();
  pending.resolve(initial);
  await start;
  expect(f.native.startSelfie).toHaveBeenCalledWith(true);
  expect(f.native.setReference).not.toHaveBeenCalled();
  expect(f.controller.state.phase).toBe('selfie');
  await f.controller.dispose();
});
test.each(['captureID', 'sourceSHA256', 'documentOperationID'] as const)(
  'preparation for another %s cannot open the camera',
  async (key) => {
    const f = fixture();
    f.native.documentFacePrepare.mockResolvedValueOnce({ ...initial, [key]: 'unrelated' });
    await f.controller.start();
    expect(f.native.startSelfie).not.toHaveBeenCalled();
    expect(f.controller.state.failure?.code).toBe('invalidResponse');
    expect(f.controller.state.snapshot).toBeUndefined();
    await f.controller.dispose();
  },
);
test.each(['captureID', 'sourceSHA256', 'documentOperationID'] as const)(
  'restored completion bound to another %s is rejected',
  async (key) => {
    const f = fixture();
    f.native.documentFaceSnapshot.mockResolvedValueOnce({ ...completed, [key]: 'unrelated' });
    await f.controller.open();
    expect(f.controller.state.snapshot).toBeUndefined();
    expect(f.controller.state.failure?.code).toBe('invalidResponse');
    await f.controller.dispose();
  },
);
test('duplicate capture signals wait for the command and compare only once without retaining selfie metadata', async () => {
  const f = fixture();
  const pending = deferred<void>();
  f.native.captureSelfie.mockReturnValueOnce(pending.promise);
  await f.controller.start();
  f.ready();
  const capture = f.controller.capture();
  await settle();
  await f.controller.capture();
  f.captured();
  f.captured();
  expect(f.native.captureSelfie).toHaveBeenCalledTimes(1);
  expect(f.native.documentFaceCompare).not.toHaveBeenCalled();
  pending.resolve();
  await capture;
  await settle();
  f.captured();
  await settle();
  expect(f.native.documentFaceCompare).toHaveBeenCalledTimes(1);
  expect(f.native.compareFace).not.toHaveBeenCalled();
  expect(f.controller.state.snapshot).toEqual(completed);
  expect(JSON.stringify(f.changed.mock.calls)).not.toContain('PRIVATE-');
  await f.controller.dispose();
});
test('capture without native readiness cannot call capture or compare', async () => {
  const f = fixture();
  await f.controller.start();
  await f.controller.capture();
  expect(f.native.captureSelfie).not.toHaveBeenCalled();
  expect(f.native.documentFaceCompare).not.toHaveBeenCalled();
  await f.controller.dispose();
});
test.each(['fail', 'manual_review'] as const)(
  '%s remains the native outcome, never promoted to pass',
  async (outcome) => {
    const f = fixture();
    f.native.documentFaceCompare.mockResolvedValueOnce({
      ...completed,
      result: { ...required(completed.result), outcome },
    });
    await f.controller.start();
    f.captured();
    await settle();
    expect(f.controller.state.snapshot?.result?.outcome).toBe(outcome);
    await f.controller.dispose();
  },
);
test('a rejected capture cannot trigger comparison from an earlier automatic event', async () => {
  const f = fixture();
  const pending = deferred<void>();
  f.native.captureSelfie.mockReturnValueOnce(pending.promise);
  await f.controller.start();
  f.ready();
  const capture = f.controller.capture();
  await settle();
  f.captured();
  pending.reject({ code: 'captureFailed' });
  await capture;
  await settle();
  expect(f.native.documentFaceCompare).not.toHaveBeenCalled();
  expect(f.controller.state.failure?.code).toBe('captureFailed');
  await f.controller.dispose();
});
test('pause waits for cancellation and delayed comparison, then restores only authoritative local state', async () => {
  const f = fixture();
  const compared = deferred<DocumentFaceSnapshot>();
  const cancelled = deferred<void>();
  f.native.documentFaceCompare.mockReturnValueOnce(compared.promise);
  f.native.cancel.mockReturnValueOnce(cancelled.promise);
  await f.controller.start();
  f.captured();
  await settle();
  const pause = f.controller.pause();
  compared.resolve(completed);
  await settle();
  expect(f.controller.state.snapshot).toBeUndefined();
  expect(f.native.documentFaceSnapshot).not.toHaveBeenCalled();
  f.native.documentFaceSnapshot.mockResolvedValueOnce(completed);
  cancelled.resolve();
  await pause;
  expect(f.controller.state.snapshot).toEqual(completed);
  expect(f.controller.state.busy).toBe(false);
  await f.controller.dispose();
});
test('failed cancellation rejects handoff, preserves ownership and requires successful settlement to retry', async () => {
  const f = fixture();
  await f.controller.start();
  f.native.cancel.mockRejectedValueOnce({ code: 'operationFailed' });
  await expect(f.controller.handoff()).rejects.toEqual({ code: 'operationFailed' });
  expect(f.native.release).not.toHaveBeenCalled();
  expect(f.native.documentFaceSnapshot).not.toHaveBeenCalled();
  expect(f.controller.state.failure?.code).toBe('operationFailed');
  const saved = await f.controller.handoff();
  expect(saved.session).toBe(f.native);
  await f.controller.dispose();
  expect(f.native.release).not.toHaveBeenCalled();
});
test('unmount during preparation releases once and fences late camera startup', async () => {
  const f = fixture();
  const prepared = deferred<DocumentFaceSnapshot>();
  f.native.documentFacePrepare.mockReturnValueOnce(prepared.promise);
  const start = f.controller.start();
  await settle();
  const closing = f.controller.dispose();
  prepared.resolve(initial);
  await start;
  await closing;
  expect(f.native.startSelfie).not.toHaveBeenCalled();
  expect(f.native.release).toHaveBeenCalledTimes(1);
  f.captured();
  await settle();
  expect(f.native.documentFaceCompare).not.toHaveBeenCalled();
});
test('unmount during cancellation cannot restore or transfer a released owner', async () => {
  const f = fixture();
  await f.controller.start();
  const cancel = deferred<void>();
  f.native.cancel.mockReturnValueOnce(cancel.promise);
  const handoff = f.controller.handoff();
  const observed = expect(handoff).rejects.toMatchObject({ code: 'cancelled' });
  await settle();
  const closing = f.controller.dispose();
  cancel.resolve();
  await closing;
  await observed;
  expect(f.native.documentFaceSnapshot).not.toHaveBeenCalled();
  expect(f.native.release).toHaveBeenCalledTimes(1);
});
test('failed release remains rejected on repeated disposal and blocks further commands', async () => {
  const f = fixture();
  const error = { code: 'operationFailed' };
  f.native.release.mockRejectedValueOnce(error);
  await expect(f.controller.dispose()).rejects.toBe(error);
  await expect(f.controller.dispose()).rejects.toBe(error);
  await f.controller.start();
  expect(f.native.documentFacePrepare).not.toHaveBeenCalled();
  expect(f.native.release).toHaveBeenCalledTimes(1);
});
test('saving an already computed result does not prepare, capture, or compare again', async () => {
  const f = fixture();
  await f.controller.start();
  f.native.documentFaceCompare.mockRejectedValueOnce({ code: 'resultSaveFailed' });
  f.captured();
  await settle();
  expect(f.controller.state.failure?.code).toBe('resultSaveFailed');
  await f.controller.retrySave();
  expect(f.controller.state.snapshot).toEqual(completed);
  expect(f.native.documentFacePrepare).toHaveBeenCalledTimes(1);
  expect(f.native.documentFaceCompare).toHaveBeenCalledTimes(1);
  expect(f.native.captureSelfie).not.toHaveBeenCalled();
  await f.controller.dispose();
});

jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
}));

test('retry after failed cancellation settles custody before preparing another attempt', async () => {
  const f = fixture();
  await f.controller.start();
  f.native.cancel.mockRejectedValueOnce({ code: 'operationFailed' });
  await expect(f.controller.pause()).rejects.toEqual({ code: 'operationFailed' });
  const cancel = deferred<void>();
  f.native.cancel.mockReturnValueOnce(cancel.promise);
  const retry = f.controller.start();
  await settle();
  expect(f.native.documentFacePrepare).toHaveBeenCalledTimes(1);
  cancel.resolve();
  await retry;
  expect(f.native.cancel).toHaveBeenCalledTimes(2);
  expect(f.native.documentFacePrepare).toHaveBeenCalledTimes(2);
  await f.controller.dispose();
});

test.each(['captureID', 'sourceSHA256', 'documentOperationID'] as const)(
  'a completed comparison for another %s is not published',
  async (key) => {
    const f = fixture();
    f.native.documentFaceCompare.mockResolvedValueOnce({ ...completed, [key]: 'other' });
    await f.controller.start();
    f.captured();
    await settle();
    expect(f.controller.state.snapshot).toBeUndefined();
    expect(f.controller.state.failure?.code).toBe('invalidResponse');
    await f.controller.dispose();
  },
);

test('a retake clears an earlier pass and failed preparation cannot restore that old acceptance', async () => {
  const f = fixture();
  f.native.documentFaceSnapshot.mockResolvedValueOnce(completed);
  await f.controller.open();
  expect(f.controller.state.snapshot).toEqual(completed);
  f.native.documentFacePrepare.mockRejectedValueOnce({ code: 'referenceUnavailable' });
  await f.controller.start();
  expect(f.controller.state.snapshot).toBeUndefined();
  expect(f.controller.state.failure?.code).toBe('referenceUnavailable');
  expect(f.native.startSelfie).not.toHaveBeenCalled();
  await f.controller.dispose();
});

test('backgrounded acquisition ignores late readiness and requires a new explicit camera start', async () => {
  const f = fixture();
  await f.controller.start();
  f.ready();
  await f.controller.pause();
  f.ready();
  f.captured();
  await settle();
  expect(f.controller.state.ready).toBe(false);
  expect(f.native.documentFaceCompare).not.toHaveBeenCalled();
  expect(f.native.startSelfie).toHaveBeenCalledTimes(1);
  await f.controller.start();
  expect(f.native.startSelfie).toHaveBeenCalledTimes(2);
  await f.controller.dispose();
});

test('generic passport selfie events cannot trigger license comparison', async () => {
  const f = fixture();
  await f.controller.start();
  f.emit({ type: 'selfieCaptured', sha256: 'PRIVATE-SELFIE-HASH', receipt });
  await settle();
  expect(f.native.documentFaceCompare).not.toHaveBeenCalled();
  expect(JSON.stringify(f.changed.mock.calls)).not.toContain('PRIVATE-');
  f.captured();
  await settle();
  expect(f.native.documentFaceCompare).toHaveBeenCalledTimes(1);
  await f.controller.dispose();
});
