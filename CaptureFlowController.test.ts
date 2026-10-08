import type {CaptureEvent, IdentityCaptureSession, MRZObservation} from '@kenshiki/identity-capture';
import {CaptureFlowController} from './CaptureFlowController';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return {promise, resolve};
}
const mrz: MRZObservation = {
  documentNumber: 'X1234567', birthDateYYMMDD: '850615', expiryDateYYMMDD: '320101',
  surname: 'SPECIMEN', givenNames: 'SYNTHETIC', nationality: 'UTO', issuingState: 'UTO', sex: 'F',
  completeness: 'complete', missingFields: [], normalizedLines: [],
};
function fixture() {
  let event!: (value: CaptureEvent) => void;
  const off = jest.fn();
  const native = {
    id: 'test', subscribe: jest.fn(listener => { event = listener; return off; }),
    startMRZ: jest.fn(async () => {}), captureMRZ: jest.fn(async () => mrz),
    readPassport: jest.fn(async () => ({...mrz, portraitAvailable: true, protocols: {}})),
    startSelfie: jest.fn(async () => {}), captureSelfie: jest.fn(async () => {}),
    compareFace: jest.fn(async () => ({similarity: .55, outcome: 'observation'})),
    cancel: jest.fn(async () => {}), release: jest.fn(async () => {}),
  };
  const create = jest.fn(async () => native as unknown as IdentityCaptureSession);
  const controller = new CaptureFlowController(create, {}, jest.fn());
  return {native, controller, create, off, emit: (value: CaptureEvent) => event(value)};
}
test('the journey uses SDK observations and keeps chip photos out of JavaScript', async () => {
  const {controller: c, native, emit} = fixture();
  await c.scan(); emit({type: 'mrzObservation', observation: mrz});
  await c.review(); expect(c.state.phase).toBe('review');
  await c.read(); expect(c.state.phase).toBe('passport');
  expect(native.readPassport).toHaveBeenCalledWith(expect.objectContaining({...mrz, consent: true}));
  await c.selfie(); emit({type: 'previewChanged', kind: 'selfie'});
  emit({type: 'selfieCaptured', sha256: 'digest', receipt: {}});
  await c.compare(); expect(c.state.phase).toBe('result');
  expect(c.state.comparison?.similarity).toBe(.55);
  await c.dispose(); expect(native.release).toHaveBeenCalledTimes(1);
});
test('a native camera failure exposes recovery and waits for cancellation to drain', async () => {
  const {controller: c, native, emit} = fixture();
  const cancelled = deferred<void>(); native.cancel.mockImplementation(() => cancelled.promise);
  await c.scan(); emit({type: 'failure', capability: 'mrz', code: 'unavailable'});
  expect(c.state.sheet?.kind).toBe('recovery'); expect(c.state.busy).toBe(true);
  await c.recover(); expect(native.startMRZ).toHaveBeenCalledTimes(1);
  emit({type: 'mrzObservation', observation: mrz}); expect(c.state.mrz).toBeUndefined();
  cancelled.resolve(); await Promise.resolve(); await c.recover();
  expect(native.startMRZ).toHaveBeenCalledTimes(2);
});
test('restarting fences a completed old read and clears native evidence', async () => {
  const {controller: c, native} = fixture();
  const read = deferred<Awaited<ReturnType<typeof native.readPassport>>>();
  native.readPassport.mockImplementation(() => read.promise);
  await c.scan(); await c.review(); const pending = c.read(); await Promise.resolve();
  await c.requestRestart(); await c.restart();
  read.resolve({...mrz, portraitAvailable: true, protocols: {}}); await pending;
  expect(c.state.phase).toBe('intro'); expect(c.state.passport).toBeUndefined();
  expect(c.state.session).toBeUndefined(); expect(native.release).toHaveBeenCalledTimes(1);
});
test('closing during session creation releases the late native session without starting capture', async () => {
  const {native} = fixture(); const create = deferred<IdentityCaptureSession>();
  const c = new CaptureFlowController(() => create.promise, {}, jest.fn());
  const pending = c.scan(); await c.dispose();
  create.resolve(native as unknown as IdentityCaptureSession); await pending;
  expect(native.startMRZ).not.toHaveBeenCalled(); expect(native.release).toHaveBeenCalledTimes(1);
});
test('repeated taps do not launch overlapping native commands', async () => {
  const {controller: c, native} = fixture(); const started = deferred<void>();
  native.startMRZ.mockImplementation(() => started.promise);
  const pending = c.scan(); await Promise.resolve(); await c.scan();
  started.resolve(); await pending; expect(native.startMRZ).toHaveBeenCalledTimes(1);
});
test('backgrounding requires an explicit resume and discards late readiness', async () => {
  const {controller: c, native, emit} = fixture();
  await c.selfie(); await c.pause();
  emit({type: 'selfieReadiness', permitsCapture: true, reason: null, blinkPhase: 'reopened'});
  expect(c.state.ready).toBe(false); expect(native.startSelfie).toHaveBeenCalledTimes(1);
  await c.recover(); expect(native.startSelfie).toHaveBeenCalledTimes(2);
});
test('invalid access fields recover to a new scan, not a repeated NFC failure', async () => {
  const {controller: c, native} = fixture();
  native.readPassport.mockRejectedValue({code: 'invalidAccessKey'});
  await c.scan(); await c.review(); await c.read();
  expect(c.state.sheet?.recovery).toBe('scan'); await c.recover();
  expect(c.state.phase).toBe('scanning'); expect(c.state.mrz).toBeUndefined();
});
test('closing unsubscribes and ignores already queued native events', async () => {
  const {controller: c, off, emit} = fixture(); await c.scan(); await c.dispose();
  emit({type: 'mrzObservation', observation: mrz});
  expect(c.state.mrz).toBeUndefined(); expect(off).toHaveBeenCalledTimes(1);
});
