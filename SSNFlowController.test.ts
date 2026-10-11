import type {
  CaptureSession,
  Configuration,
  SSNSessionSnapshot,
  SSNVerificationReceipt,
} from '@kenshiki/identity-capture';
import { ssnBinding, ssnOperationID, ssnReceipt } from './__tests__/ssnFixture';
import { mockSession as makeSession } from './__tests__/support';
import { SSNFlowController } from './SSNFlowController';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function tick() {
  for (let i = 0; i < 12; ++i) await Promise.resolve();
}
const configuration: Configuration = {
  ssn: {
    contextID: 'test-holder',
    providerID: 'test-provider',
    directoryURL: 'file:///test',
    keychainService: 'test',
    keychainAccount: 'test',
  },
};
const receipt: SSNVerificationReceipt = ssnReceipt;
const ready: SSNSessionSnapshot = {
  state: 'ready',
  entryDigits: '',
  confirmation: null,
  attempt: null,
  receipt: null,
  failure: null,
  recoveryNeeded: false,
  busy: false,
};
const pending: SSNSessionSnapshot = {
  ...ready,
  state: 'failed',
  attempt: { operationID: ssnOperationID, binding: ssnBinding },
  recoveryNeeded: true,
};
const complete: SSNSessionSnapshot = { ...ready, state: 'completed', attempt: pending.attempt, receipt };
function fixture(initial = ready, configured = true) {
  let snapshot = initial;
  const native = {
    id: 'ssn-session',
    ssnSnapshot: jest.fn(async () => snapshot),
    ssnRequestConfirmation: jest.fn(async (digits: string) => {
      snapshot = {
        ...snapshot,
        state: 'confirming',
        entryDigits: digits,
        confirmation: { id: 'confirmation-token', digits },
      };
      return snapshot;
    }),
    ssnRequestFreshConfirmation: jest.fn(async (digits: string) => {
      snapshot = {
        ...snapshot,
        state: 'confirming',
        entryDigits: digits,
        confirmation: { id: 'replacement-token', digits },
      };
      return snapshot;
    }),
    ssnConfirm: jest.fn(async (_id: string) => {
      snapshot = complete;
      return snapshot;
    }),
    ssnResendUnresolved: jest.fn(async () => snapshot),
    ssnRecover: jest.fn(async () => {
      snapshot = complete;
      return snapshot;
    }),
    ssnCancel: jest.fn(async () => {
      snapshot = { ...snapshot, state: 'ready', entryDigits: '', confirmation: null, busy: false };
      return snapshot;
    }),
    release: jest.fn(async () => {}),
  };
  const session = makeSession(native);
  const create = jest.fn(async () => session);
  const c = new SSNFlowController(create, configured ? configuration : {}, jest.fn());
  return {
    c,
    native,
    session,
    create,
    commit: (value: SSNSessionSnapshot) => {
      snapshot = value;
    },
  };
}
async function prepare(f: ReturnType<typeof fixture>) {
  await f.c.open();
  f.c.beginEntry();
  f.c.setDigits('000-00-1234');
  await f.c.requestConfirmation();
}

test('review creates only the exact native confirmation; confirm consumes its token with no new digit argument', async () => {
  const f = fixture();
  await prepare(f);
  expect(f.native.ssnRequestConfirmation).toHaveBeenCalledWith('000001234');
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
  expect(f.c.state.sheet?.kind).toBe('confirmation');
  expect(f.c.state.snapshot?.confirmation?.digits).toBe('000001234');
  await f.c.confirm();
  expect(f.native.ssnConfirm).toHaveBeenCalledWith('confirmation-token');
  expect(f.c.state.digits).toBe('');
  expect(f.c.state.snapshot?.confirmation).toBeNull();
  expect(f.c.state.snapshot?.receipt).toBe(receipt);
});
test('editing revokes the native confirmation and keeps only transient editable digits', async () => {
  const f = fixture();
  await prepare(f);
  await f.c.edit();
  expect(f.native.ssnCancel).toHaveBeenCalledTimes(1);
  expect(f.c.state.digits).toBe('000001234');
  expect(f.c.state.snapshot?.confirmation).toBeNull();
  expect(f.c.state.sheet).toBeUndefined();
  await f.c.confirm();
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});
test('an unresolved operation requires status before another entry', async () => {
  const f = fixture(pending);
  await f.c.open();
  f.c.beginEntry();
  f.c.setDigits('000001234');
  await f.c.requestConfirmation();
  expect(f.c.state.editing).toBe(false);
  expect(f.native.ssnRequestFreshConfirmation).not.toHaveBeenCalled();
  expect(f.native.ssnRequestConfirmation).not.toHaveBeenCalled();
  await f.c.resend();
  expect(f.native.ssnRecover).toHaveBeenCalledTimes(1);
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});
test('a response failure reconciles original status without another purchase', async () => {
  const f = fixture();
  await prepare(f);
  f.native.ssnConfirm.mockImplementationOnce(async () => {
    f.commit({ ...pending, failure: 'timedOut' });
    throw { code: 'timedOut' };
  });
  await f.c.confirm();
  expect(f.c.state.sheet).toMatchObject({ kind: 'recovery', recovery: 'resend' });
  expect(f.c.state.snapshot?.attempt?.operationID).toBe(ssnOperationID);
  await f.c.retry();
  expect(f.native.ssnRecover).toHaveBeenCalledTimes(1);
  expect(f.native.ssnRequestFreshConfirmation).not.toHaveBeenCalled();
  expect(f.c.state.editing).toBe(false);
  expect(f.native.ssnResendUnresolved).not.toHaveBeenCalled();
  expect(f.c.state.snapshot?.attempt?.operationID).toBe(ssnOperationID);
  expect(f.native.ssnConfirm).toHaveBeenCalledTimes(1);
  expect(f.native.ssnRequestConfirmation).toHaveBeenCalledTimes(1);
});
test('backgrounding immediately redacts digits and never restores a delayed confirmation response', async () => {
  const f = fixture();
  await f.c.open();
  f.c.beginEntry();
  f.c.setDigits('000001234');
  const confirmation = deferred<SSNSessionSnapshot>();
  const oldSnapshot = {
    ...ready,
    state: 'confirming' as const,
    entryDigits: '000001234',
    confirmation: { id: 'old-token', digits: '000001234' },
  };
  f.native.ssnRequestConfirmation.mockImplementationOnce(() => {
    f.commit(oldSnapshot);
    return confirmation.promise;
  });
  const reviewing = f.c.requestConfirmation();
  await tick();
  const pausing = f.c.pause();
  expect(f.c.state.digits).toBe('');
  expect(f.c.state.snapshot?.confirmation).toBeNull();
  confirmation.resolve(oldSnapshot);
  await reviewing;
  await pausing;
  expect(f.c.state.snapshot?.entryDigits).toBe('');
  expect(f.c.state.snapshot?.confirmation).toBeNull();
  expect(f.c.state.sheet?.kind).toBe('recovery');
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});
test('late native completion during interruption reconciles receipt before ownership is handed off', async () => {
  const f = fixture();
  await prepare(f);
  const answer = deferred<SSNSessionSnapshot>();
  const cancel = deferred<SSNSessionSnapshot>();
  f.native.ssnConfirm.mockImplementationOnce(() => answer.promise);
  f.native.ssnCancel.mockImplementationOnce(() => cancel.promise);
  const checking = f.c.confirm();
  await tick();
  const pausing = f.c.pause();
  f.commit(complete);
  answer.resolve(complete);
  await checking;
  expect(f.c.state.busy).toBe(true);
  cancel.resolve(complete);
  await pausing;
  const result = await f.c.handoff();
  expect(result?.snapshot.receipt).toBe(receipt);
  expect(result?.snapshot.entryDigits).toBe('');
  expect(result?.snapshot.confirmation).toBeNull();
  await f.c.dispose();
  expect(f.native.release).not.toHaveBeenCalled();
});
test('leaving confirmation clears every digit before returning a redacted native session to Identity', async () => {
  const f = fixture();
  await prepare(f);
  const result = await f.c.handoff();
  expect(JSON.stringify(result?.snapshot)).not.toContain('000001234');
  expect(f.c.state.digits).toBe('');
  expect(f.native.ssnCancel).toHaveBeenCalledTimes(1);
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});
test('duplicate confirm taps cannot issue overlapping requests', async () => {
  const f = fixture();
  await prepare(f);
  const answer = deferred<SSNSessionSnapshot>();
  f.native.ssnConfirm.mockImplementationOnce(() => answer.promise);
  const checking = f.c.confirm();
  await tick();
  await f.c.confirm();
  expect(f.native.ssnConfirm).toHaveBeenCalledTimes(1);
  f.commit(complete);
  answer.resolve(complete);
  await checking;
});
test.each([false, true])(
  'closing during creation drains custody without a check (release fails: %s)',
  async (releaseFails) => {
    const f = fixture();
    const session = deferred<CaptureSession>();
    const c = new SSNFlowController(() => session.promise, configuration, jest.fn());
    const opening = c.open();
    const released = deferred<void>();
    const failure = { code: 'operationFailed' };
    f.native.release.mockImplementation(async () => {
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
    await tick();
    expect(closed).toBe(false);
    session.resolve(f.session);
    await tick();
    expect(closed).toBe(false);
    released.resolve();
    await opening;
    expect(await closing).toEqual(releaseFails ? failure : undefined);
    if (releaseFails) await expect(c.dispose()).rejects.toEqual(failure);
    expect(f.native.release).toHaveBeenCalledTimes(1);
    expect(f.native.ssnSnapshot).not.toHaveBeenCalled();
  },
);
test('backgrounding during native creation offers explicit reopening and releases the late session', async () => {
  const old = fixture();
  const next = fixture();
  const delayed = deferred<CaptureSession>();
  const create = jest
    .fn()
    .mockImplementationOnce(() => delayed.promise)
    .mockResolvedValue(next.session);
  const c = new SSNFlowController(create, configuration, jest.fn());
  const opening = c.open();
  const pausing = c.pause();
  expect(c.state.busy).toBe(true);
  delayed.resolve(old.session);
  await opening;
  await pausing;
  expect(old.native.release).toHaveBeenCalledTimes(1);
  expect(old.native.ssnSnapshot).not.toHaveBeenCalled();
  expect(c.state.busy).toBe(false);
  expect(c.state.sheet).toMatchObject({ kind: 'recovery', recovery: 'open' });
  expect(create).toHaveBeenCalledTimes(1);
  await c.retry();
  expect(next.native.ssnSnapshot).toHaveBeenCalledTimes(1);
  expect(c.state.snapshot?.state).toBe('ready');
  expect(c.state.sheet).toBeUndefined();
  expect(next.native.ssnConfirm).not.toHaveBeenCalled();
});
test('missing provider setup names the service, never ID or phone prerequisites', async () => {
  const f = fixture(ready, false);
  await f.c.open();
  expect(f.c.state.sheet).toMatchObject({ kind: 'recovery', recovery: 'exit' });
  expect(JSON.stringify(f.c.state)).not.toMatch(/document|phone check|capture|choose ID/);
  expect(f.create).not.toHaveBeenCalled();
  expect(await f.c.handoff()).toBeUndefined();
});
test('entry opens from an introduction with no native confirmation or request', async () => {
  const f = fixture();
  await f.c.open();
  expect(f.c.state.editing).toBe(false);
  expect(f.native.ssnRequestConfirmation).not.toHaveBeenCalled();
  f.c.beginEntry();
  expect(f.c.state.editing).toBe(true);
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});
test('a failed save reconciles original status and blocks another purchase', async () => {
  const f = fixture({ ...pending, state: 'failed', failure: 'storageUnavailable' });
  await f.c.open();
  expect(f.c.state.sheet).toMatchObject({ kind: 'recovery', recovery: 'resend' });
  f.c.beginEntry();
  expect(f.c.state.editing).toBe(false);
  await f.c.retry();
  expect(f.native.ssnRecover).toHaveBeenCalledTimes(1);
  expect(f.native.ssnRequestFreshConfirmation).not.toHaveBeenCalled();
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});
test('failed cancellation keeps ownership and recovery visible instead of releasing unrevoked confirmation', async () => {
  const f = fixture();
  await prepare(f);
  f.native.ssnCancel.mockRejectedValueOnce({ code: 'unavailable' });
  await expect(f.c.handoff()).rejects.toEqual({ code: 'unavailable' });
  expect(f.native.release).not.toHaveBeenCalled();
  expect(f.c.state.digits).toBe('');
  expect(f.c.state.snapshot?.confirmation).toBeNull();
  expect(f.c.state.sheet?.kind).toBe('recovery');
});
test('backgrounding a completed result keeps it available without asking for another number', async () => {
  const f = fixture(complete);
  await f.c.open();
  await f.c.pause();
  expect(f.c.state.snapshot?.receipt).toBe(receipt);
  expect(f.c.state.sheet).toBeUndefined();
  expect(f.c.state.editing).toBe(false);
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});

jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('../../ReactNative/identity-capture/src/codes')>(
    '../../ReactNative/identity-capture/src/codes',
  ).isCaptureErrorCode,
}));

test('same-operation recovery accepts a result without asking for digits or a new purchase', async () => {
  const f = fixture(pending);
  await f.c.open();
  f.native.ssnRecover.mockResolvedValueOnce(complete);
  await f.c.resend();
  expect(f.c.state.snapshot?.receipt).toEqual(receipt);
  expect(f.native.ssnResendUnresolved).not.toHaveBeenCalled();
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
  expect(f.native.ssnRequestConfirmation).not.toHaveBeenCalled();
  expect(f.native.ssnRequestFreshConfirmation).not.toHaveBeenCalled();
});

// The bound five-check contract reconciles the original operation before another entry.
test('W2 unresolved operation cannot open a replacement number or fresh confirmation', async () => {
  const f = fixture(pending);
  await f.c.open();
  f.c.beginEntry();
  f.c.setDigits('000001234');
  await f.c.requestConfirmation();
  expect(f.c.state.editing).toBe(false);
  expect(f.native.ssnRequestFreshConfirmation).not.toHaveBeenCalled();
  expect(f.native.ssnRequestConfirmation).not.toHaveBeenCalled();
});
test('W2 recovery queries status without resending digits to the supplier', async () => {
  const f = fixture(pending);
  await f.c.open();
  await f.c.resend();
  expect(f.native.ssnRecover).toHaveBeenCalledTimes(1);
  expect(f.native.ssnResendUnresolved).not.toHaveBeenCalled();
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});

test('opening waits for native custody before presenting a saved result', async () => {
  const f = fixture();
  const read = deferred<SSNSessionSnapshot>();
  f.native.ssnSnapshot.mockReturnValueOnce(read.promise);
  const opening = f.c.open();
  await tick();
  expect(f.c.state.opening).toBe(true);
  expect(f.c.state.snapshot).toBeUndefined();
  read.resolve(complete);
  await opening;
  expect(f.c.state.opening).toBe(false);
  expect(f.c.state.snapshot?.receipt).toEqual(receipt);
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
});

test('a changed native context clears the previously displayed receipt', async () => {
  const f = fixture(complete);
  await f.c.open();
  f.native.ssnSnapshot.mockRejectedValue({ code: 'contextChanged' });
  await f.c.open();
  expect(f.c.state.snapshot).toBeUndefined();
  expect(f.c.state.opening).toBe(false);
  expect(f.c.state.sheet).toMatchObject({ kind: 'recovery', recovery: 'exit' });
  expect(f.native.ssnConfirm).not.toHaveBeenCalled();
  await expect(f.c.handoff()).resolves.toBeUndefined();
  expect(f.native.release).toHaveBeenCalledTimes(1);
});
