import type {Configuration, IdentityCaptureSession, SSNSessionSnapshot, SSNVerificationReceipt} from '@kenshiki/identity-capture';
import {SSNFlowController} from './SSNFlowController';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return {promise, resolve}; }
async function tick() { for (let i = 0; i < 12; ++i) await Promise.resolve(); }
const configuration = {ssn: {}} as Configuration;
const binding = {installationID: 'synthetic', enrollmentID: 'enrollment', documentOperationID: 'document', phoneChallengeID: 'phone'};
const receipt: SSNVerificationReceipt = {operationID: 'operation', binding, checkedAt: '2026-10-07T20:00:00Z',
  reportKind: 'issuanceOnly', issuance: 'issued', reportedOutcome: 'affirmative', details: null, replayed: false};
const ready: SSNSessionSnapshot = {state: 'ready', entryDigits: '', confirmation: null, attempt: null,
  receipt: null, failure: null, recoveryNeeded: false, busy: false};
const pending: SSNSessionSnapshot = {...ready, state: 'pending', attempt: {operationID: 'operation', binding}, recoveryNeeded: true};
const complete: SSNSessionSnapshot = {...ready, state: 'completed', attempt: pending.attempt, receipt};
function fixture(initial = ready, configured = true) {
  let snapshot = initial;
  const native = {
    id: 'ssn-session', ssnSnapshot: jest.fn(async () => snapshot),
    ssnRequestConfirmation: jest.fn(async (digits: string) => {
      snapshot = {...snapshot, state: 'confirming', entryDigits: digits, confirmation: {id: 'confirmation-token', digits}};
      return snapshot;
    }),
    ssnConfirm: jest.fn(async (_id: string) => { snapshot = complete; return snapshot; }),
    ssnRecover: jest.fn(async () => { snapshot = complete; return snapshot; }),
    ssnCancel: jest.fn(async () => { snapshot = {...snapshot, state: 'ready', entryDigits: '', confirmation: null, busy: false}; return snapshot; }),
    release: jest.fn(async () => {}),
  };
  const session = native as unknown as IdentityCaptureSession;
  const create = jest.fn(async () => session);
  const c = new SSNFlowController(create, configured ? configuration : {}, jest.fn());
  return {c, native, session, create, commit: (value: SSNSessionSnapshot) => { snapshot = value; }};
}
async function prepare(f: ReturnType<typeof fixture>) {
  await f.c.open(); f.c.setDigits('000-00-1234'); await f.c.requestConfirmation();
}

test('review creates only the exact native confirmation; confirm consumes its token with no new digit argument', async () => {
  const f = fixture(); await prepare(f);
  expect(f.native.ssnRequestConfirmation).toHaveBeenCalledWith('000001234');
  expect(f.native.ssnConfirm).not.toHaveBeenCalled(); expect(f.c.state.sheet?.kind).toBe('confirmation');
  expect(f.c.state.snapshot?.confirmation?.digits).toBe('000001234');
  await f.c.confirm(); expect(f.native.ssnConfirm).toHaveBeenCalledWith('confirmation-token');
  expect(f.c.state.digits).toBe(''); expect(f.c.state.snapshot?.confirmation).toBeNull();
  expect(f.c.state.snapshot?.receipt).toBe(receipt);
});
test('editing revokes the native confirmation and keeps only transient editable digits', async () => {
  const f = fixture(); await prepare(f); await f.c.edit();
  expect(f.native.ssnCancel).toHaveBeenCalledTimes(1); expect(f.c.state.digits).toBe('000001234');
  expect(f.c.state.snapshot?.confirmation).toBeNull(); expect(f.c.state.sheet).toBeUndefined();
  await f.c.confirm(); expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});
test('an unresolved saved operation always recovers status before accepting another number', async () => {
  const f = fixture(pending); await f.c.open(); f.c.setDigits('000001234'); await f.c.requestConfirmation();
  expect(f.native.ssnRecover).toHaveBeenCalledTimes(1); expect(f.native.ssnRequestConfirmation).not.toHaveBeenCalled();
  expect(f.native.ssnConfirm).not.toHaveBeenCalled(); expect(f.c.state.digits).toBe('');
});
test('a response failure reads native pending ownership and offers status recovery without resubmission', async () => {
  const f = fixture(); await prepare(f);
  f.native.ssnConfirm.mockImplementationOnce(async () => { f.commit({...pending, state: 'failed', failure: 'timedOut'}); throw {code: 'timedOut'}; });
  await f.c.confirm(); expect(f.c.state.sheet).toMatchObject({kind: 'recovery', recovery: 'status'});
  expect(f.c.state.snapshot?.attempt?.operationID).toBe('operation');
  await f.c.retry(); expect(f.native.ssnRecover).toHaveBeenCalledTimes(1);
  expect(f.native.ssnConfirm).toHaveBeenCalledTimes(1); expect(f.native.ssnRequestConfirmation).toHaveBeenCalledTimes(1);
});
test('backgrounding immediately redacts digits and never restores a delayed confirmation response', async () => {
  const f = fixture(); await f.c.open(); f.c.setDigits('000001234');
  const confirmation = deferred<SSNSessionSnapshot>();
  const oldSnapshot = {...ready, state: 'confirming' as const, entryDigits: '000001234', confirmation: {id: 'old-token', digits: '000001234'}};
  f.native.ssnRequestConfirmation.mockImplementationOnce(() => { f.commit(oldSnapshot); return confirmation.promise; });
  const reviewing = f.c.requestConfirmation(); await tick(); const pausing = f.c.pause();
  expect(f.c.state.digits).toBe(''); expect(f.c.state.snapshot?.confirmation).toBeNull();
  confirmation.resolve(oldSnapshot); await reviewing; await pausing;
  expect(f.c.state.snapshot?.entryDigits).toBe(''); expect(f.c.state.snapshot?.confirmation).toBeNull();
  expect(f.c.state.sheet?.kind).toBe('recovery'); expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});
test('late native completion during interruption reconciles receipt before ownership is handed off', async () => {
  const f = fixture(); await prepare(f);
  const answer = deferred<SSNSessionSnapshot>(); const cancel = deferred<SSNSessionSnapshot>();
  f.native.ssnConfirm.mockImplementationOnce(() => answer.promise);
  f.native.ssnCancel.mockImplementationOnce(() => cancel.promise);
  const checking = f.c.confirm(); await tick(); const pausing = f.c.pause();
  f.commit(complete); answer.resolve(complete); await checking;
  expect(f.c.state.busy).toBe(true); cancel.resolve(complete); await pausing;
  const result = await f.c.handoff(); expect(result?.snapshot.receipt).toBe(receipt);
  expect(result?.snapshot.entryDigits).toBe(''); expect(result?.snapshot.confirmation).toBeNull();
  await f.c.dispose(); expect(f.native.release).not.toHaveBeenCalled();
});
test('leaving confirmation clears every digit before returning a redacted native session to Identity', async () => {
  const f = fixture(); await prepare(f); const result = await f.c.handoff();
  expect(JSON.stringify(result?.snapshot)).not.toContain('000001234');
  expect(f.c.state.digits).toBe(''); expect(f.native.ssnCancel).toHaveBeenCalledTimes(1);
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});
test('duplicate confirm taps cannot issue overlapping requests', async () => {
  const f = fixture(); await prepare(f); const answer = deferred<SSNSessionSnapshot>();
  f.native.ssnConfirm.mockImplementationOnce(() => answer.promise);
  const checking = f.c.confirm(); await tick(); await f.c.confirm();
  expect(f.native.ssnConfirm).toHaveBeenCalledTimes(1);
  f.commit(complete); answer.resolve(complete); await checking;
});
test('closing during native session creation releases the late session and performs no check', async () => {
  const f = fixture(); const session = deferred<IdentityCaptureSession>();
  const c = new SSNFlowController(() => session.promise, configuration, jest.fn());
  const opening = c.open(); await c.dispose(); session.resolve(f.session); await opening;
  expect(f.native.release).toHaveBeenCalledTimes(1); expect(f.native.ssnSnapshot).not.toHaveBeenCalled();
});
test('missing setup has a prerequisite sheet with no fabricated binding or native request', async () => {
  const f = fixture(ready, false); await f.c.open();
  expect(f.c.state.sheet).toMatchObject({kind: 'recovery', recovery: 'exit'});
  expect(f.create).not.toHaveBeenCalled(); expect(await f.c.handoff()).toBeUndefined();
});
test('failed cancellation keeps ownership and recovery visible instead of releasing unrevoked confirmation', async () => {
  const f = fixture(); await prepare(f); f.native.ssnCancel.mockRejectedValueOnce({code: 'unavailable'});
  await expect(f.c.handoff()).rejects.toEqual({code: 'unavailable'});
  expect(f.native.release).not.toHaveBeenCalled(); expect(f.c.state.digits).toBe('');
  expect(f.c.state.snapshot?.confirmation).toBeNull(); expect(f.c.state.sheet?.kind).toBe('recovery');
});
test('backgrounding a completed result keeps it available without asking for another number', async () => {
  const f = fixture(complete); await f.c.open(); await f.c.pause();
  expect(f.c.state.snapshot?.receipt).toBe(receipt); expect(f.c.state.sheet).toBeUndefined();
  expect(f.c.state.editing).toBe(false); expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});
