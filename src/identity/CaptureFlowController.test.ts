import type {
  CaptureEvent,
  CaptureSession,
  FaceComparison,
  MRZObservation,
  PassportObservation,
} from '@kenshiki/identity-capture';
import { mockSession as makeSession } from '../testing/support';
import { CaptureFlowController } from './CaptureFlowController';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const mrz: MRZObservation = {
  documentNumber: 'X1234567',
  birthDateYYMMDD: '850615',
  expiryDateYYMMDD: '320101',
  surname: 'SPECIMEN',
  givenNames: 'SYNTHETIC',
  nationality: 'UTO',
  issuingState: 'UTO',
  sex: 'F',
  completeness: 'complete',
  missingFields: [],
  normalizedLines: [],
};
const passport: PassportObservation = {
  ...mrz,
  portraitAvailable: true,
  portraitSHA256: 'reference',
  protocolVerdicts: { source: 'thisRead' },
  personalNumber: null,
  dateOfIssue: null,
  issuingAuthority: null,
  placeOfBirth: null,
  correspondence: { documentNumber: 'matches' },
  protocols: {
    basicAccessControl: 'succeeded',
    pace: 'notPerformed',
    activeAuthentication: 'notPerformed',
    chipAuthentication: 'notPerformed',
    countrySigningChain: 'succeeded',
    documentSignature: 'succeeded',
    dataGroupHashes: 'succeeded',
  },
};
const comparison: FaceComparison = {
  similarity: 0.55,
  outcome: 'pass',
  implementationVersion: 'test',
  referenceSHA256: 'reference',
  selfieSHA256: 'selfie',
  route: 'scrfd',
  modelLoadingSeconds: 0,
  comparisonSeconds: 1,
  admissionReceipt: {
    policyVersion: 'test',
    frameTimestamp: 1,
    anchorID: 'synthetic-anchor',
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
  },
};
async function settle() {
  for (let i = 0; i < 8; ++i) await Promise.resolve();
}
function fixture() {
  let event!: (value: CaptureEvent) => void;
  const off = jest.fn();
  const native = {
    id: 'test',
    subscribe: jest.fn((listener: (event: CaptureEvent) => void) => {
      event = listener;
      return off;
    }),
    startMRZ: jest.fn(async () => {}),
    captureMRZ: jest.fn(async () => mrz),
    readPassport: jest.fn(async () => passport),
    startSelfie: jest.fn(async () => {}),
    captureSelfie: jest.fn(async () => {}),
    compareFace: jest.fn(async () => comparison),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  };
  const create = jest.fn(async () => makeSession(native));
  const controller = new CaptureFlowController(create, {}, jest.fn());
  return { native, controller, create, off, emit: (value: CaptureEvent) => event(value) };
}
test('the journey uses SDK observations and keeps chip photos out of JavaScript', async () => {
  const { controller: c, native, emit } = fixture();
  const startup = deferred<void>();
  native.startMRZ.mockImplementationOnce(() => startup.promise);
  const scanning = c.scan();
  await settle();
  emit({ type: 'mrzObservation', observation: mrz });
  emit({ type: 'mrzObservation', observation: mrz });
  expect(native.captureMRZ).not.toHaveBeenCalled();
  startup.resolve();
  await scanning;
  await settle();
  expect(native.captureMRZ).toHaveBeenCalledTimes(1);
  expect(c.state.phase).toBe('review');
  await c.read();
  expect(c.state.phase).toBe('passport');
  expect(native.readPassport).toHaveBeenCalledWith(expect.objectContaining({ ...mrz, consent: true }));
  await c.selfie();
  emit({ type: 'previewChanged', kind: 'selfie' });
  emit({ type: 'selfieCaptured', sha256: 'digest', receipt: comparison.admissionReceipt });
  await settle();
  expect(c.state.phase).toBe('result');
  expect(native.compareFace).toHaveBeenCalledTimes(1);
  expect(c.state.comparison?.similarity).toBe(0.55);
  await c.dispose();
  expect(native.release).toHaveBeenCalledTimes(1);
});
test('a native camera failure exposes recovery and waits for cancellation to drain', async () => {
  const { controller: c, native, emit } = fixture();
  const cancelled = deferred<void>();
  native.cancel.mockImplementation(() => cancelled.promise);
  await c.scan();
  emit({ type: 'failure', capability: 'mrz', code: 'cameraInterrupted' });
  expect(c.state.sheet?.kind).toBe('recovery');
  expect(c.state.busy).toBe(true);
  await c.recover();
  expect(native.startMRZ).toHaveBeenCalledTimes(1);
  emit({ type: 'mrzObservation', observation: mrz });
  expect(c.state.mrz).toBeUndefined();
  cancelled.resolve();
  await settle();
  await c.recover();
  expect(native.startMRZ).toHaveBeenCalledTimes(2);
});
test('confirming restart clears a read that settled during restart confirmation', async () => {
  const { controller: c, native } = fixture();
  const read = deferred<Awaited<ReturnType<typeof native.readPassport>>>();
  native.readPassport.mockImplementation(() => read.promise);
  await c.scan();
  await c.review();
  const pending = c.read();
  await Promise.resolve();
  const stopping = c.requestRestart();
  read.resolve(passport);
  await pending;
  await stopping;
  await c.restart();
  expect(c.state.phase).toBe('intro');
  expect(c.state.passport).toBeUndefined();
  expect(c.state.session).toBeUndefined();
  expect(native.release).toHaveBeenCalledTimes(1);
});
test.each([false, true])(
  'closing during creation drains custody (release fails: %s)',
  async (releaseFails) => {
    const { native } = fixture();
    const create = deferred<CaptureSession>();
    const c = new CaptureFlowController(() => create.promise, {}, jest.fn());
    const pending = c.scan();
    const released = deferred<void>();
    const failure = { code: 'operationFailed' };
    native.release.mockImplementation(async () => {
      await released.promise;
      if (releaseFails) throw failure;
    });
    let closed = false;
    const closing = c.dispose().then(
      () => {
        closed = true;
        return undefined;
      },
      (error: unknown) => {
        closed = true;
        return error;
      },
    );
    await settle();
    expect(closed).toBe(false);
    create.resolve(makeSession(native));
    await settle();
    expect(closed).toBe(false);
    released.resolve();
    await pending;
    expect(await closing).toEqual(releaseFails ? failure : undefined);
    if (releaseFails) await expect(c.dispose()).rejects.toEqual(failure);
    expect(native.startMRZ).not.toHaveBeenCalled();
    expect(native.release).toHaveBeenCalledTimes(1);
  },
);
test('repeated taps do not launch overlapping native commands', async () => {
  const { controller: c, native } = fixture();
  const started = deferred<void>();
  native.startMRZ.mockImplementation(() => started.promise);
  const pending = c.scan();
  await Promise.resolve();
  await c.scan();
  started.resolve();
  await pending;
  expect(native.startMRZ).toHaveBeenCalledTimes(1);
});
test('backgrounding requires an explicit resume and discards late readiness', async () => {
  const { controller: c, native, emit } = fixture();
  await c.selfie();
  await c.pause();
  emit({ type: 'selfieReadiness', permitsCapture: true, reason: null, blinkPhase: 'reopened' });
  expect(c.state.ready).toBe(false);
  expect(native.startSelfie).toHaveBeenCalledTimes(1);
  await c.recover();
  expect(native.startSelfie).toHaveBeenCalledTimes(2);
});
test('invalid access fields recover to a new scan, not a repeated NFC failure', async () => {
  const { controller: c, native } = fixture();
  native.readPassport.mockRejectedValue({ code: 'invalidAccessKey' });
  await c.scan();
  await c.review();
  await c.read();
  expect(c.state.sheet?.recovery).toBe('scan');
  await c.recover();
  expect(c.state.phase).toBe('scanning');
  expect(c.state.mrz).toBeUndefined();
});
test('closing unsubscribes and ignores already queued native events', async () => {
  const { controller: c, off, emit } = fixture();
  await c.scan();
  await c.dispose();
  emit({ type: 'mrzObservation', observation: mrz });
  expect(c.state.mrz).toBeUndefined();
  expect(off).toHaveBeenCalledTimes(1);
});
test('Done transfers results and native ownership before unmount without releasing evidence', async () => {
  const { controller: c, native, emit } = fixture();
  await c.scan();
  await c.review();
  await c.read();
  await c.selfie();
  emit({ type: 'selfieCaptured', sha256: 'selfie', receipt: comparison.admissionReceipt });
  await settle();
  const result = await c.handoff();
  expect(result.passport).toBe(passport);
  expect(result.comparison).toBe(comparison);
  expect(native.cancel).toHaveBeenCalledTimes(1);
  await c.dispose();
  expect(native.release).not.toHaveBeenCalled();
  await result.session.release();
  expect(native.release).toHaveBeenCalledTimes(1);
});
test('passport results can be handed off before a selfie and resumed without rescanning', async () => {
  const { controller: c, native, create, emit } = fixture();
  await c.scan();
  await c.review();
  await c.read();
  const result = await c.handoff();
  expect(result.comparison).toBeUndefined();
  const resumed = new CaptureFlowController(create, {}, jest.fn(), result);
  await resumed.selfie();
  emit({ type: 'selfieCaptured', sha256: 'selfie', receipt: comparison.admissionReceipt });
  await settle();
  expect(resumed.state.phase).toBe('result');
  expect(native.readPassport).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  await resumed.dispose();
  expect(native.release).toHaveBeenCalledTimes(1);
});
test('NFC system cancellation quietly returns to printed details for a direct retry', async () => {
  const { controller: c, native } = fixture();
  native.readPassport.mockRejectedValueOnce({ code: 'cancelled' });
  await c.scan();
  await c.review();
  await c.read();
  expect(c.state.phase).toBe('review');
  expect(c.state.sheet).toBeUndefined();
  expect(c.state.mrz).toBe(mrz);
  await c.read();
  expect(c.state.phase).toBe('passport');
  expect(native.startMRZ).toHaveBeenCalledTimes(1);
});
test('automatic comparison waits for the manual capture command to settle', async () => {
  const { controller: c, native, emit } = fixture();
  const captured = deferred<void>();
  native.captureSelfie.mockImplementation(() => captured.promise);
  await c.scan();
  await c.review();
  await c.read();
  await c.selfie();
  const pending = c.capture();
  await settle();
  emit({ type: 'selfieCaptured', sha256: 'selfie', receipt: comparison.admissionReceipt });
  expect(native.compareFace).not.toHaveBeenCalled();
  captured.resolve();
  await pending;
  await settle();
  expect(native.compareFace).toHaveBeenCalledTimes(1);
  expect(c.state.phase).toBe('result');
});
test('failed comparison keeps the passport and targets a new selfie when capture is unusable', async () => {
  const { controller: c, native, emit } = fixture();
  native.compareFace.mockRejectedValueOnce({ code: 'faceImageUnreadable' });
  await c.scan();
  await c.review();
  await c.read();
  await c.selfie();
  emit({ type: 'selfieCaptured', sha256: 'selfie', receipt: comparison.admissionReceipt });
  await settle();
  expect(c.state.sheet?.recovery).toBe('selfie');
  expect(c.state.passport).toBe(passport);
  await c.recover();
  expect(native.startSelfie).toHaveBeenCalledTimes(2);
  expect(native.readPassport).toHaveBeenCalledTimes(1);
});
async function complete(f: ReturnType<typeof fixture>) {
  await f.controller.scan();
  await f.controller.review();
  await f.controller.read();
  await f.controller.selfie();
  f.emit({ type: 'selfieCaptured', sha256: 'selfie', receipt: comparison.admissionReceipt });
  await settle();
}
test('cancelled reread keeps the completed passport and comparison and returns to results', async () => {
  const f = fixture();
  await complete(f);
  f.native.readPassport.mockRejectedValueOnce({ code: 'cancelled' });
  await f.controller.read();
  expect(f.controller.state.phase).toBe('result');
  expect(f.controller.state.sheet).toBeUndefined();
  expect(f.controller.state.passport).toBe(passport);
  expect(f.controller.state.comparison).toBe(comparison);
});
test('failed reread leaves the old result available for handoff', async () => {
  const f = fixture();
  await complete(f);
  f.native.readPassport.mockRejectedValueOnce({ code: 'connectionLost' });
  await f.controller.read();
  const result = await f.controller.handoff();
  expect(result.passport).toBe(passport);
  expect(result.comparison).toBe(comparison);
});
test('failed and cancelled retakes preserve the completed comparison', async () => {
  const f = fixture();
  await complete(f);
  f.native.startSelfie.mockRejectedValueOnce({ code: 'cameraUnavailable' });
  await f.controller.selfie();
  expect(f.controller.state.sheet?.recovery).toBe('details');
  await f.controller.recover();
  expect(f.controller.state.phase).toBe('result');
  expect(f.controller.state.comparison).toBe(comparison);
  await f.controller.selfie();
  await f.controller.pause();
  const result = await f.controller.handoff();
  expect(result.comparison).toBe(comparison);
});
test('no comparable pair requests a new selfie instead of recomputing the same pixels', async () => {
  const f = fixture();
  await complete(f);
  f.native.compareFace.mockRejectedValueOnce({ code: 'comparisonUnavailable' });
  await f.controller.selfie();
  f.emit({ type: 'selfieCaptured', sha256: 'retake', receipt: comparison.admissionReceipt });
  await settle();
  expect(f.controller.state.sheet?.recovery).toBe('selfie');
  expect(f.controller.state.comparison).toBe(comparison);
  await f.controller.recover();
  expect(f.native.startSelfie).toHaveBeenCalledTimes(3);
  expect(f.native.compareFace).toHaveBeenCalledTimes(2);
});
test('printed and chip mismatches block selfie acquisition and preserve passport results', async () => {
  const f = fixture();
  f.native.readPassport.mockResolvedValueOnce({ ...passport, correspondence: { surname: 'differs' } });
  await f.controller.scan();
  await f.controller.review();
  await f.controller.read();
  await f.controller.selfie();
  expect(f.native.startSelfie).not.toHaveBeenCalled();
  expect(f.controller.state.sheet?.recovery).toBe('scan');
  expect(f.controller.state.passport?.documentNumber).toBe(passport.documentNumber);
});
test('camera denial offers Settings and NFC progress retains bounded percentage and group', async () => {
  const f = fixture();
  await f.controller.scan();
  f.emit({ type: 'failure', capability: 'mrz', code: 'cameraPermissionDenied' });
  await settle();
  expect(f.controller.state.sheet?.recovery).toBe('settings');
  await f.controller.recover();
  await f.controller.review();
  const pending = deferred<PassportObservation>();
  f.native.readPassport.mockImplementationOnce(() => pending.promise);
  const read = f.controller.read();
  await settle();
  f.emit({ type: 'passportProgress', stage: 'reading', progress: 62, group: 'DG2' });
  expect(f.controller.state.progress).toContain('DG2');
  expect(f.controller.state.progress).toContain('62%');
  f.emit({ type: 'passportProgress', stage: 'reading', progress: 200, group: 'arbitrary payload' });
  expect(f.controller.state.progress).toContain('100%');
  expect(f.controller.state.progress).not.toContain('arbitrary');
  pending.resolve(passport);
  await read;
});
test('abandoning a reviewed rescan hands off and rereads the MRZ paired with the completed chip', async () => {
  const f = fixture();
  await complete(f);
  const draft = { ...mrz, documentNumber: 'Y9999999', surname: 'DRAFT' };
  f.native.captureMRZ.mockResolvedValueOnce(draft);
  await f.controller.scan();
  f.emit({ type: 'mrzObservation', observation: draft });
  await settle();
  expect(f.controller.state.mrz).toBe(draft);
  const result = await f.controller.handoff();
  expect(result.mrz).toBe(mrz);
  const resumed = new CaptureFlowController(f.create, {}, jest.fn(), result);
  await resumed.read();
  expect(f.native.readPassport).toHaveBeenLastCalledWith(
    expect.objectContaining({ documentNumber: mrz.documentNumber }),
  );
});
test('an unclassified comparison failure retries with a new selfie', async () => {
  const f = fixture();
  f.native.compareFace.mockRejectedValueOnce({ code: 'operationFailed' });
  await complete(f);
  expect(f.controller.state.sheet?.recovery).toBe('selfie');
  await f.controller.recover();
  expect(f.native.startSelfie).toHaveBeenCalledTimes(2);
  expect(f.native.compareFace).toHaveBeenCalledTimes(1);
});
test('a native reread committed before cancellation reconciles metadata before results can be handed off', async () => {
  const f = fixture();
  await complete(f);
  const replacement = { ...passport, portraitSHA256: 'new-reference', surname: 'REPLACEMENT' };
  const read = deferred<PassportObservation>();
  const cancel = deferred<void>();
  f.native.readPassport.mockImplementationOnce(() => read.promise);
  f.native.cancel.mockImplementationOnce(() => cancel.promise);
  const reading = f.controller.read();
  await settle();
  const paused = f.controller.pause();
  read.resolve(replacement);
  await reading;
  expect(f.controller.state.phase).toBe('reading');
  expect(f.controller.state.busy).toBe(true);
  expect(f.controller.state.passport).toBe(replacement);
  expect(f.controller.state.comparison).toBeUndefined();
  cancel.resolve();
  await paused;
  const result = await f.controller.handoff();
  expect(result.passport.portraitSHA256).toBe('new-reference');
});
test('cancellation waits for delayed JS result delivery even when native cancel resolves first', async () => {
  const f = fixture();
  await complete(f);
  const compared = deferred<FaceComparison>();
  f.native.compareFace.mockImplementationOnce(() => compared.promise);
  await f.controller.selfie();
  f.emit({ type: 'selfieCaptured', sha256: 'new-selfie', receipt: comparison.admissionReceipt });
  await settle();
  const paused = f.controller.pause();
  await settle();
  expect(f.controller.state.busy).toBe(true);
  const replacement = { ...comparison, selfieSHA256: 'new-selfie' };
  compared.resolve(replacement);
  await paused;
  expect(f.controller.state.phase).toBe('comparing');
  expect(f.controller.state.comparison).toBe(replacement);
  expect((await f.controller.handoff()).comparison?.selfieSHA256).toBe('new-selfie');
});
test('closing fences a successful result delivered after release begins', async () => {
  const f = fixture();
  await f.controller.scan();
  await f.controller.review();
  const read = deferred<PassportObservation>();
  f.native.readPassport.mockImplementationOnce(() => read.promise);
  const reading = f.controller.read();
  await settle();
  const closing = f.controller.dispose();
  read.resolve(passport);
  await reading;
  await closing;
  expect(f.controller.state.passport).toBeUndefined();
  expect(f.native.release).toHaveBeenCalledTimes(1);
});

test('configured custody reopens a bound passport and face without repeating acquisition', async () => {
  const f = fixture();
  const native = Object.assign(f.native, {
    listResults: jest.fn(async () => [
      {
        id: 'saved',
        revision: 1,
        recordedAt: '2026-10-08T12:00:00Z',
        kind: 'passport-read-v1',
        workflowID: 'saved',
        artifacts: [],
      },
      {
        kind: 'face-comparison-v1',
        workflowID: 'saved',
        artifacts: [{ role: 'reference', sha256: 'reference' }],
      },
    ]),
    recoverPassport: jest.fn(async () => ({ ...passport, printedMRZ: mrz })),
    recoverFace: jest.fn(async () => comparison),
  });
  const c = new CaptureFlowController(
    f.create,
    { results: { directoryURL: 'file:///test', keychainService: 'test', keychainAccount: 'test' } },
    jest.fn(),
  );
  await c.open();
  expect(c.state.phase).toBe('result');
  expect(c.state.comparison).toBe(comparison);
  expect(native.recoverFace).toHaveBeenCalledWith('saved');
  expect(native.readPassport).not.toHaveBeenCalled();
  expect(native.startSelfie).not.toHaveBeenCalled();
  await c.dispose();
});
test('a retained face from a replaced passport is not restored onto the new passport', async () => {
  const f = fixture();
  const native = Object.assign(f.native, {
    listResults: jest.fn(async () => [
      {
        id: 'saved',
        revision: 1,
        recordedAt: '2026-10-08T12:00:00Z',
        kind: 'passport-read-v1',
        workflowID: 'saved',
        artifacts: [],
      },
      {
        kind: 'face-comparison-v1',
        workflowID: 'saved',
        artifacts: [{ role: 'reference', sha256: 'old-reference' }],
      },
    ]),
    recoverPassport: jest.fn(async () => ({ ...passport, printedMRZ: mrz })),
    recoverFace: jest.fn(),
  });
  const c = new CaptureFlowController(
    f.create,
    { results: { directoryURL: 'file:///test', keychainService: 'test', keychainAccount: 'test' } },
    jest.fn(),
  );
  await c.open();
  expect(c.state.phase).toBe('passport');
  expect(c.state.comparison).toBeUndefined();
  expect(native.recoverFace).not.toHaveBeenCalled();
  await c.dispose();
});
test('saving a completed read retries local storage without scanning or reading again', async () => {
  const f = fixture();
  const native = Object.assign(f.native, {
    retryResultSave: jest.fn(async () => ({ ...passport, printedMRZ: mrz })),
  });
  native.readPassport.mockRejectedValueOnce({ code: 'resultSaveFailed' });
  await f.controller.scan();
  await f.controller.review();
  await f.controller.read();
  expect(f.controller.state.sheet?.recovery).toBe('save');
  await f.controller.recover();
  expect(f.controller.state.phase).toBe('passport');
  expect(native.readPassport).toHaveBeenCalledTimes(1);
  expect(native.retryResultSave).toHaveBeenCalledTimes(1);
});
test('a broken saved store offers recovery instead of treating it as a first capture', async () => {
  const f = fixture();
  Object.assign(f.native, {
    listResults: jest.fn(async () => {
      throw { code: 'resultIntegrityFailure' };
    }),
  });
  const c = new CaptureFlowController(
    f.create,
    { results: { directoryURL: 'file:///test', keychainService: 'test', keychainAccount: 'test' } },
    jest.fn(),
  );
  await c.open();
  expect(c.state.phase).toBe('loading');
  expect(c.state.sheet?.recovery).toBe('load');
  expect(f.native.startMRZ).not.toHaveBeenCalled();
  await c.dispose();
});

jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
}));
