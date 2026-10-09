import type {CaptureEvent, IdentityCaptureSession, PhoneCheckSnapshot} from '@kenshiki/identity-capture';
import {PhoneFlowController} from './PhoneFlowController';

const ready: PhoneCheckSnapshot = {stage: 'start', busy: false, failure: null, pending: false, sent: false,
  receipt: null, recordedAt: null, sendAgainAt: null, challengeReserved: false};
const waiting: PhoneCheckSnapshot = {...ready, stage: 'waiting', pending: true, sent: true};
const complete: PhoneCheckSnapshot = {...ready, stage: 'completed', receipt: {
  challengeID: 'synthetic', sender: '12025550123', messageHash: '0'.repeat(64),
  receivedAt: '2026-10-08T12:00:00Z', completedAt: '2026-10-08T12:00:01Z',
  subjectComparison: {status: 'contradicted', fieldsCompared: ['givenName'], checkedAt: '2026-10-08T12:00:01Z',
    evidence: {requestID: 'synthetic', providers: [{source: 'synthetic-source', answered: true, numberValid: false, smsFraudRiskScore: 0}],
      fields: [{field: 'newField', source: 'newSource', grade: 'newGrade'}]}},
  subscriberFailure: null,
}};
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return {promise, resolve}; }
async function tick() { for (let i = 0; i < 15; ++i) await Promise.resolve(); }
function fixture(initial = ready) {
  let snapshot = initial;
  let listener: ((event: CaptureEvent) => void) | undefined;
  const off = jest.fn(() => { listener = undefined; });
  const native = {
    subscribe: jest.fn((value: (event: CaptureEvent) => void) => { listener = value; return off; }),
    phoneSnapshot: jest.fn(async () => snapshot), phoneCancel: jest.fn(async () => snapshot),
    phoneSend: jest.fn(async (_consent: true) => { snapshot = waiting; return snapshot; }),
    phoneResume: jest.fn(async () => snapshot), phoneRetrySave: jest.fn(async () => snapshot),
    phoneStartOver: jest.fn(async (_consent: true) => { snapshot = {...ready, pending: true, receipt: snapshot.receipt}; return snapshot; }),
    phoneErase: jest.fn(async () => { snapshot = ready; }), release: jest.fn(async () => {}),
  };
  const session = native as unknown as IdentityCaptureSession;
  const create = jest.fn(async () => session);
  const c = new PhoneFlowController(create, {}, jest.fn());
  return {c, native, create, session, off,
    commit: (value: PhoneCheckSnapshot) => { snapshot = value; },
    emit: (value: PhoneCheckSnapshot) => { snapshot = value; listener?.({type: 'phoneSnapshot', snapshot: value}); }};
}
test('opening and reopening only read local state and do not send or poll', async () => {
  const f = fixture(complete); await f.c.open();
  expect(f.native.phoneSend).not.toHaveBeenCalled(); expect(f.native.phoneResume).not.toHaveBeenCalled();
  expect(f.c.state.snapshot?.receipt).toEqual(complete.receipt);
  const saved = await f.c.handoff(); await f.c.dispose();
  expect(f.off).toHaveBeenCalledTimes(1); expect(f.native.release).not.toHaveBeenCalled();
  const next = new PhoneFlowController(f.create, {}, jest.fn(), saved); await next.open();
  expect(next.state.snapshot?.receipt?.subjectComparison?.evidence?.providers[0].numberValid).toBe(false);
  expect(next.state.snapshot?.receipt?.subjectComparison?.evidence?.fields[0].grade).toBe('newGrade');
  expect(f.create).toHaveBeenCalledTimes(1); await next.dispose();
});
test('sent waits for the native service receipt and asynchronous receipt events keep every detail', async () => {
  const f = fixture(); await f.c.open(); await f.c.send();
  expect(f.native.phoneSend).toHaveBeenCalledWith(true); expect(f.c.state.snapshot?.receipt).toBeNull();
  f.emit(complete); expect(f.c.state.snapshot?.receipt).toEqual(complete.receipt);
  expect(f.c.state.snapshot?.receipt?.subjectComparison?.status).toBe('contradicted');
});
test('duplicate sends cannot overlap while Apple composition is in progress', async () => {
  const f = fixture(); await f.c.open(); const composed = deferred<PhoneCheckSnapshot>();
  f.native.phoneSend.mockImplementationOnce(() => composed.promise);
  const sending = f.c.send(); await tick(); await f.c.send();
  expect(f.native.phoneSend).toHaveBeenCalledTimes(1); composed.resolve(waiting); await sending;
});
test('a command response cannot overwrite a newer asynchronously published receipt', async () => {
  const f = fixture(); await f.c.open(); const composed = deferred<PhoneCheckSnapshot>();
  f.native.phoneSend.mockImplementationOnce(() => composed.promise);
  const sending = f.c.send(); await tick(); f.emit(complete); composed.resolve(waiting); await sending;
  expect(f.c.state.snapshot?.receipt).toBe(complete.receipt);
});
test('backgrounding drains native work before handoff and ignores late command snapshots', async () => {
  const f = fixture(); await f.c.open(); const composed = deferred<PhoneCheckSnapshot>();
  const cancelled = deferred<PhoneCheckSnapshot>();
  f.native.phoneSend.mockImplementationOnce(() => composed.promise);
  f.native.phoneCancel.mockImplementationOnce(() => cancelled.promise);
  const sending = f.c.send(); await tick(); const pausing = f.c.pause();
  composed.resolve({...ready, stage: 'compose'}); await sending;
  expect(f.c.state.busy).toBe(true);
  f.commit(complete); cancelled.resolve(complete); await pausing;
  expect(f.c.state.snapshot?.receipt).toBe(complete.receipt);
  expect(f.c.state.busy).toBe(false);
});
test('reopened pending check explicitly resumes the same operation with no automatic send', async () => {
  const f = fixture(waiting); await f.c.open(); expect(f.c.state.paused).toBe(true);
  await f.c.resume(); expect(f.native.phoneResume).toHaveBeenCalledTimes(1);
  expect(f.native.phoneSend).not.toHaveBeenCalled(); expect(f.native.phoneStartOver).not.toHaveBeenCalled();
});
test('replacement requires a sheet confirmation and a failed replacement retains the previous receipt', async () => {
  const f = fixture(complete); await f.c.open(); f.c.ask('restart');
  expect(f.native.phoneStartOver).not.toHaveBeenCalled(); await f.c.confirm();
  expect(f.native.phoneStartOver).toHaveBeenCalledWith(true);
  f.native.phoneSend.mockRejectedValueOnce({code: 'unavailable'}); await f.c.send();
  expect(f.c.state.snapshot?.receipt).toBe(complete.receipt); expect(f.c.state.sheet?.kind).toBe('error');
});
test('local save recovery never sends another message', async () => {
  const f = fixture({...waiting, stage: 'finishing', failure: 'storageUnavailable'}); await f.c.open(); await f.c.save();
  expect(f.native.phoneRetrySave).toHaveBeenCalledTimes(1); expect(f.native.phoneSend).not.toHaveBeenCalled();
});
test('explicit erase drains first and does not clear the displayed result on failure', async () => {
  const f = fixture(complete); await f.c.open(); f.c.ask('erase');
  expect(f.native.phoneErase).not.toHaveBeenCalled();
  f.native.phoneErase.mockRejectedValueOnce({code: 'storageUnavailable'}); await f.c.confirm();
  expect(f.native.phoneCancel).toHaveBeenCalledTimes(1); expect(f.c.state.snapshot?.receipt).toBe(complete.receipt);
  f.c.ask('erase'); await f.c.confirm(); expect(f.c.state.snapshot?.receipt).toBeNull();
});
test('failed cancellation keeps ownership and blocks returning a still active session', async () => {
  const f = fixture(waiting); await f.c.open(); f.native.phoneCancel.mockRejectedValueOnce({code: 'unavailable'});
  await expect(f.c.handoff()).rejects.toEqual({code: 'unavailable'});
  expect(f.native.release).not.toHaveBeenCalled(); expect(f.c.state.sheet?.kind).toBe('error');
});
test('closing during creation releases the late session and never opens it', async () => {
  const f = fixture(); const created = deferred<IdentityCaptureSession>();
  const c = new PhoneFlowController(() => created.promise, {}, jest.fn());
  const opening = c.open(); const closing = c.dispose(); created.resolve(f.session);
  await opening; await closing;
  expect(f.native.release).toHaveBeenCalledTimes(1); expect(f.native.phoneSnapshot).not.toHaveBeenCalled();
});
test('a missing native provider shows a recoverable sheet and still allows exit', async () => {
  const c = new PhoneFlowController(async () => { throw {code: 'phoneNotConfigured'}; }, {}, jest.fn());
  await c.open(); expect(c.state.sheet?.kind).toBe('error'); expect(await c.handoff()).toBeUndefined();
});
test('a changed installation hides the previous personal result until context is re-established', async () => {
  const f = fixture(complete); await f.c.open();
  f.native.phoneSnapshot.mockRejectedValueOnce({code: 'contextChanged'});
  await f.c.open(); expect(f.c.state.snapshot).toBeUndefined();
  expect(f.c.state.sheet?.kind).toBe('error'); await f.c.handoff();
});
