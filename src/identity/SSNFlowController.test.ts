import type {
  CaptureSession,
  Configuration,
  SSNSessionSnapshot,
  SSNVerificationReceipt,
} from '@kenshiki/identity-capture';
import { ssnOperationID, ssnReceipt } from '../testing/ssnFixture';
import { mockSession as makeSession } from '../testing/support';
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
const presentation = { strings: { entryTitle: 'Enter SSN' }, fields: {}, outcomes: {} };
const receipt: SSNVerificationReceipt = ssnReceipt;
const ready: SSNSessionSnapshot = {
  state: 'ready',
  attempt: null,
  receipt: null,
  failure: null,
  recoveryNeeded: false,
  busy: false,
};
const pending: SSNSessionSnapshot = {
  ...ready,
  state: 'failed',
  attempt: { operationID: ssnOperationID },
  recoveryNeeded: true,
};
const complete: SSNSessionSnapshot = { ...ready, state: 'completed', attempt: pending.attempt, receipt };
function fixture(initial = ready, configured = true) {
  let snapshot = initial;
  const native = {
    id: 'ssn-session',
    ssnSnapshot: jest.fn(async () => snapshot),
    ssnEntry: jest.fn(async (_presentation: typeof presentation) => {
      snapshot = complete;
      return snapshot;
    }),
    ssnRecover: jest.fn(async () => {
      snapshot = complete;
      return snapshot;
    }),
    ssnResendUnresolved: jest.fn(async () => snapshot),
    ssnCancel: jest.fn(async () => snapshot),
    ssnErase: jest.fn(async () => {
      snapshot = ready;
    }),
    release: jest.fn(async () => {}),
  };
  const session = makeSession(native);
  const create = jest.fn(async () => session);
  const c = new SSNFlowController(
    create,
    configured ? configuration : {},
    jest.fn(),
    undefined,
    presentation,
  );
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
test('mount restores only; explicit entry sends presentation only and returns safe native result', async () => {
  const f = fixture();
  await f.c.open();
  expect(f.native.ssnEntry).not.toHaveBeenCalled();
  expect(f.native.ssnRecover).not.toHaveBeenCalled();
  await f.c.beginEntry();
  expect(f.native.ssnEntry).toHaveBeenCalledWith(presentation);
  expect(f.c.state.snapshot).toEqual(complete);
  expect(f.c.state).not.toHaveProperty('digits');
  expect(f.c.state).not.toHaveProperty('editing');
});
test('duplicate entry taps cannot overlap native presentations', async () => {
  const f = fixture();
  await f.c.open();
  const answer = deferred<SSNSessionSnapshot>();
  f.native.ssnEntry.mockReturnValueOnce(answer.promise);
  const entering = f.c.beginEntry();
  await tick();
  await f.c.beginEntry();
  expect(f.native.ssnEntry).toHaveBeenCalledTimes(1);
  answer.resolve(complete);
  await entering;
});
test('missing presentation rejects entry without silently presenting empty native copy', async () => {
  const f = fixture();
  const c = new SSNFlowController(f.create, configuration, jest.fn());
  await c.open();
  await c.beginEntry();
  expect(f.native.ssnEntry).not.toHaveBeenCalled();
  expect(c.state.sheet).toMatchObject({ recovery: 'exit' });
});
test('unresolved receipt requires status and never dispatches replacement entry', async () => {
  const f = fixture(pending);
  await f.c.open();
  await f.c.beginEntry();
  expect(f.native.ssnEntry).not.toHaveBeenCalled();
  await f.c.resend();
  expect(f.native.ssnRecover).toHaveBeenCalledTimes(1);
  expect(f.native.ssnResendUnresolved).not.toHaveBeenCalled();
  expect(f.c.state.snapshot?.attempt?.operationID).toBe(ssnOperationID);
});
test('lost entry reply reconciles local status and recovers original operation', async () => {
  const f = fixture();
  await f.c.open();
  f.native.ssnEntry.mockImplementationOnce(async () => {
    f.commit({ ...pending, failure: 'timedOut' });
    throw { code: 'timedOut' };
  });
  await f.c.beginEntry();
  expect(f.c.state.sheet).toMatchObject({ recovery: 'resend' });
  await f.c.retry();
  expect(f.native.ssnEntry).toHaveBeenCalledTimes(1);
  expect(f.native.ssnRecover).toHaveBeenCalledTimes(1);
  expect(f.native.ssnResendUnresolved).not.toHaveBeenCalled();
  expect(f.c.state.snapshot?.receipt).toEqual(receipt);
});
test('handoff waits for both late native entry and cancel before reading committed receipt', async () => {
  const f = fixture();
  await f.c.open();
  const answer = deferred<SSNSessionSnapshot>();
  const cancel = deferred<SSNSessionSnapshot>();
  f.native.ssnEntry.mockReturnValueOnce(answer.promise);
  f.native.ssnCancel.mockReturnValueOnce(cancel.promise);
  const entering = f.c.beginEntry();
  await tick();
  let done = false;
  const leaving = f.c.handoff().then((result) => {
    done = true;
    return result;
  });
  await tick();
  cancel.resolve(ready);
  await tick();
  expect(done).toBe(false);
  f.commit(complete);
  answer.resolve(ready);
  await entering;
  const saved = await leaving;
  expect(saved?.snapshot).toEqual(complete);
  expect(saved?.session).toBe(f.session);
  await f.c.dispose();
  expect(f.native.release).not.toHaveBeenCalled();
});
test('failed cancellation retains session; a new entry retries settlement before showing native UI', async () => {
  const f = fixture();
  await f.c.open();
  f.native.ssnCancel.mockRejectedValueOnce({ code: 'unavailable' });
  await expect(f.c.handoff()).rejects.toEqual({ code: 'unavailable' });
  expect(f.native.release).not.toHaveBeenCalled();
  expect(f.c.state.sheet?.kind).toBe('recovery');
  await f.c.beginEntry();
  expect(f.native.ssnCancel).toHaveBeenCalledTimes(2);
  expect(f.native.ssnEntry).toHaveBeenCalledTimes(1);
});
test('refused continuation retains custody and allows a subsequent accepted transfer once', async () => {
  const f = fixture(complete);
  await f.c.open();
  await expect(f.c.handoff(() => false)).rejects.toMatchObject({ code: 'contextChanged' });
  expect(f.native.release).not.toHaveBeenCalled();
  expect(f.c.disposalStarted).toBe(false);
  expect((await f.c.handoff(() => true))?.session).toBe(f.session);
  expect(await f.c.handoff()).toBeUndefined();
  await f.c.dispose();
  expect(f.native.release).not.toHaveBeenCalled();
});
test('unmount during delayed cancellation cannot restore or hand off a disposed owner', async () => {
  const f = fixture();
  await f.c.open();
  const cancel = deferred<SSNSessionSnapshot>();
  f.native.ssnCancel.mockReturnValueOnce(cancel.promise);
  const leaving = f.c.handoff().catch((error: unknown) => error);
  await tick();
  const reads = f.native.ssnSnapshot.mock.calls.length;
  const disposed = f.c.dispose();
  cancel.resolve(ready);
  await disposed;
  expect(await leaving).toMatchObject({ code: 'cancelled' });
  expect(f.native.ssnSnapshot).toHaveBeenCalledTimes(reads);
  expect(f.native.release).toHaveBeenCalledTimes(1);
});
test('concurrent pause callers share settlement instead of releasing early', async () => {
  const f = fixture();
  await f.c.open();
  const cancel = deferred<SSNSessionSnapshot>();
  f.native.ssnCancel.mockReturnValueOnce(cancel.promise);
  const first = f.c.pause();
  const second = f.c.pause();
  expect(first).toBe(second);
  await tick();
  expect(f.native.ssnCancel).toHaveBeenCalledTimes(1);
  cancel.resolve(ready);
  await Promise.all([first, second]);
});
test('failed erase preserves retained receipt and requires explicit recovery', async () => {
  const f = fixture(complete);
  await f.c.open();
  f.native.ssnErase.mockRejectedValueOnce({ code: 'storageUnavailable' });
  await f.c.erase();
  expect(f.c.state.snapshot?.receipt).toEqual(receipt);
  expect(f.c.state.sheet).toMatchObject({ recovery: 'open' });
  expect(f.native.ssnEntry).not.toHaveBeenCalled();
});
test('disposal failure remains rejected across repeat exit and dispose attempts', async () => {
  const f = fixture();
  await f.c.open();
  f.c.fail({ code: 'unauthorized' });
  f.native.release.mockRejectedValueOnce({ code: 'operationFailed' });
  await expect(f.c.handoff()).rejects.toEqual({ code: 'operationFailed' });
  await expect(f.c.handoff()).rejects.toEqual({ code: 'operationFailed' });
  await expect(f.c.dispose()).rejects.toEqual({ code: 'operationFailed' });
  expect(f.native.release).toHaveBeenCalledTimes(1);
  await f.c.beginEntry();
  expect(f.native.ssnEntry).not.toHaveBeenCalled();
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
  expect(next.native.ssnEntry).not.toHaveBeenCalled();
});
test('missing provider setup names the service, never ID or phone prerequisites', async () => {
  const f = fixture(ready, false);
  await f.c.open();
  expect(f.c.state.sheet).toMatchObject({ kind: 'recovery', recovery: 'exit' });
  expect(JSON.stringify(f.c.state)).not.toMatch(/document|phone check|capture|choose ID/);
  expect(f.create).not.toHaveBeenCalled();
  expect(await f.c.handoff()).toBeUndefined();
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
  expect(f.native.ssnEntry).not.toHaveBeenCalled();
});

test('a changed native context clears the previously displayed receipt', async () => {
  const f = fixture(complete);
  await f.c.open();
  f.native.ssnSnapshot.mockRejectedValue({ code: 'contextChanged' });
  await f.c.open();
  expect(f.c.state.snapshot).toBeUndefined();
  expect(f.c.state.opening).toBe(false);
  expect(f.c.state.sheet).toMatchObject({ kind: 'recovery', recovery: 'exit' });
  expect(f.native.ssnEntry).not.toHaveBeenCalled();
  await expect(f.c.handoff()).resolves.toBeUndefined();
  expect(f.native.release).toHaveBeenCalledTimes(1);
});

jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
}));
