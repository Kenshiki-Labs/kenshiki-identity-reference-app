import type {
  CaptureSession,
  Configuration,
  DocumentCustodyPresentation,
  SSNSessionSnapshot,
} from '@kenshiki/identity-capture';
import { AppState, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ssnCompletedSnapshot, ssnReceipt } from '../testing/ssnFixture';
import { actionSheets, invoke, mockSession, required, settle } from '../testing/support';
import { SSNFlow } from './SSNFlow';
import { ControllerCustodyContext, createControllerCustody } from '../ui/ControllerCustody';
import { Page } from '../ui/Page';

const mockCreate = jest.fn<Promise<CaptureSession>, [Configuration]>();
jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCaptureSession: { create: (value: Configuration) => mockCreate(value) },
  IdentitySymbol: 'Symbol',
}));
const configuration: Configuration = {
  ssn: {
    contextID: 'holder',
    providerID: 'provider',
    directoryURL: 'file:///ssn',
    keychainService: 'ssn',
    keychainAccount: 'ssn',
  },
};
const ready: SSNSessionSnapshot = {
  state: 'ready',
  attempt: null,
  receipt: null,
  failure: null,
  recoveryNeeded: false,
  busy: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
async function fixture(snapshot = ready, guided = false) {
  let current = snapshot;
  const session = mockSession({
    ssnSnapshot: jest.fn(async () => current),
    ssnCancel: jest.fn(async () => current),
    ssnEntry: jest.fn(async (_copy: DocumentCustodyPresentation) => {
      current = ssnCompletedSnapshot;
      return current;
    }),
    ssnDetails: jest.fn(async (_copy: DocumentCustodyPresentation) => current),
    ssnRecover: jest.fn(async () => current),
    ssnErase: jest.fn(async () => {
      current = ready;
    }),
    release: jest.fn(async () => {}),
  });
  mockCreate.mockResolvedValue(session);
  const complete = jest.fn(),
    exit = jest.fn(),
    next = jest.fn(() => true),
    custody = createControllerCustody();
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <ControllerCustodyContext.Provider value={custody}>
        <SSNFlow
          configuration={configuration}
          guided={guided}
          onComplete={complete}
          onExit={exit}
          onContinue={next}
        />
      </ControllerCustodyContext.Provider>,
    );
    await settle();
  });
  async function tap(id: string) {
    await act(async () => {
      await invoke(view.root.findByProps({ testID: id }), 'onPress');
      await settle();
    });
  }
  async function close() {
    await act(async () => {
      await invoke(view.root.findByType(Page), 'onClose');
      await settle();
    });
  }
  async function unmount() {
    await act(async () => {
      view.unmount();
      await settle();
    });
  }
  return { view, session, complete, exit, next, custody, tap, close, unmount };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
});

test('mount restores only; explicit entry opens one native sheet and no React PII input exists', async () => {
  const f = await fixture();
  expect(f.session.ssnEntry).not.toHaveBeenCalled();
  expect(f.session.ssnRecover).not.toHaveBeenCalled();
  expect(f.view.root.findAllByType(TextInput)).toHaveLength(0);
  await f.tap('ssn-begin-entry');
  expect(f.session.ssnEntry).toHaveBeenCalledTimes(1);
  const copy = required(f.session.ssnEntry.mock.calls[0])[0];
  expect(copy.strings.confirmationTitle).toBe('Confirm your number');
  expect(f.view.root.findAllByProps({ testID: 'ssn-result' }).length).toBeGreaterThan(0);
  expect(f.view.root.findAllByProps({ testID: 'ssn-confirmation-number' })).toHaveLength(0);
  await f.unmount();
  expect(f.session.release).toHaveBeenCalledTimes(1);
});

test('duplicate entry taps share one native presentation until completion', async () => {
  const f = await fixture();
  const result = deferred<SSNSessionSnapshot>();
  f.session.ssnEntry.mockReturnValueOnce(result.promise);
  let entering: unknown;
  await act(async () => {
    const action = f.view.root.findByProps({ testID: 'ssn-begin-entry' });
    entering = invoke(action, 'onPress');
    invoke(action, 'onPress');
    await settle();
  });
  expect(f.session.ssnEntry).toHaveBeenCalledTimes(1);
  await act(async () => {
    result.resolve(ssnCompletedSnapshot);
    await entering;
  });
  await f.unmount();
});

test('native sheet failure is redacted and remains recoverable', async () => {
  const f = await fixture();
  f.session.ssnEntry.mockRejectedValueOnce(new Error('PII-CANARY 000001234'));
  await f.tap('ssn-begin-entry');
  expect(JSON.stringify(f.view.toJSON())).not.toMatch(/PII-CANARY|000001234/);
  expect(f.view.root.findAllByProps({ testID: 'ssn-bottom-sheet' }).length).toBeGreaterThan(0);
  await f.tap('ssn-retry');
  expect(f.session.ssnEntry).toHaveBeenCalledTimes(2);
  await f.unmount();
});

test('unresolved attempt offers status recovery and cannot open replacement entry', async () => {
  const f = await fixture({
    ...ready,
    state: 'pending',
    attempt: { operationID: 'opaque-operation' },
    recoveryNeeded: true,
  });
  expect(f.view.root.findAllByProps({ testID: 'ssn-begin-entry' })).toHaveLength(0);
  await f.tap('ssn-resend-unresolved');
  expect(f.session.ssnRecover).toHaveBeenCalledTimes(1);
  expect(f.session.ssnEntry).not.toHaveBeenCalled();
  await f.unmount();
});

test('erase cancels before clearing and keeps the receipt after a failed erase', async () => {
  const f = await fixture(ssnCompletedSnapshot);
  const sheets = actionSheets();
  await f.tap('ssn-erase');
  expect(f.session.ssnErase).not.toHaveBeenCalled();
  f.session.ssnErase.mockRejectedValueOnce({ code: 'storageUnavailable' });
  await act(async () => {
    sheets.last().choose(0);
    await settle();
  });
  expect(required(f.session.ssnCancel.mock.invocationCallOrder[0])).toBeLessThan(
    required(f.session.ssnErase.mock.invocationCallOrder[0]),
  );
  expect(f.view.root.findAllByProps({ testID: 'ssn-result' }).length).toBeGreaterThan(0);
  await f.tap('ssn-retry');
  await f.tap('ssn-erase');
  await act(async () => {
    sheets.last().choose(0);
    await settle();
  });
  expect(f.view.root.findAllByProps({ testID: 'ssn-result' })).toHaveLength(0);
  sheets.spy.mockRestore();
  await f.unmount();
});

test('Back drains a pending native entry and retains its safe result without a second check', async () => {
  const f = await fixture();
  const pending = deferred<SSNSessionSnapshot>();
  f.session.ssnEntry.mockReturnValueOnce(pending.promise);
  let entry: unknown, closing: unknown;
  await act(async () => {
    entry = invoke(f.view.root.findByProps({ testID: 'ssn-begin-entry' }), 'onPress');
    await settle();
    closing = invoke(f.view.root.findByType(Page), 'onClose');
    await settle();
  });
  expect(f.complete).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve(ready);
    await entry;
    await closing;
  });
  expect(f.complete).toHaveBeenCalledWith({ session: f.session, snapshot: ready });
  await f.unmount();
  expect(f.session.release).not.toHaveBeenCalled();
  await f.session.release();
});

test('failed cancellation keeps the screen and owner until Back can settle', async () => {
  const f = await fixture();
  f.session.ssnCancel.mockRejectedValueOnce({ code: 'busy' });
  await f.close();
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.exit).not.toHaveBeenCalled();
  expect(f.session.release).not.toHaveBeenCalled();
  await f.close();
  expect(f.complete).toHaveBeenCalledTimes(1);
  await f.unmount();
  await f.session.release();
});

test('unmount during Back cannot navigate from a late receipt', async () => {
  const f = await fixture();
  const cancelled = deferred<SSNSessionSnapshot>();
  f.session.ssnCancel.mockReturnValueOnce(cancelled.promise);
  let closing: unknown;
  await act(async () => {
    closing = invoke(f.view.root.findByType(Page), 'onClose');
    await settle();
  });
  await f.unmount();
  await act(async () => {
    cancelled.resolve(ready);
    await closing;
  });
  await f.custody.releasing;
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.exit).not.toHaveBeenCalled();
  expect(f.session.release).toHaveBeenCalledTimes(1);
});

test.each([
  ssnReceipt,
  { ...ssnReceipt, reportedOutcome: 'affirmative' as const },
  { ...ssnReceipt, reportKind: 'issuanceOnly' as const, fiveChecks: null },
])(
  'guided flow cannot continue from incomplete, contradictory, or issuance-only receipt',
  async (receipt) => {
    const f = await fixture({ ...ready, state: 'completed', receipt }, true);
    expect(f.view.root.findAllByProps({ testID: 'onboarding-ssn-continue' })).toHaveLength(0);
    expect(f.view.root.findAllByProps({ testID: 'ssn-erase' })).toHaveLength(0);
    await f.unmount();
  },
);

test.each(['changed operation', 'pending', 'refused transfer'] as const)(
  'guided Continue rejects %s while retaining custody',
  async (reason) => {
    const f = await fixture(ssnCompletedSnapshot, true);
    if (reason === 'changed operation')
      f.session.ssnSnapshot.mockResolvedValueOnce({
        ...ssnCompletedSnapshot,
        receipt: { ...required(ssnCompletedSnapshot.receipt), operationID: 'replacement' },
      });
    if (reason === 'pending')
      f.session.ssnSnapshot.mockResolvedValueOnce({ ...ssnCompletedSnapshot, recoveryNeeded: true });
    if (reason === 'refused transfer') f.next.mockReturnValue(false);
    await f.tap('onboarding-ssn-continue');
    expect(f.next).toHaveBeenCalledTimes(reason === 'refused transfer' ? 1 : 0);
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.session.release).not.toHaveBeenCalled();
    await f.unmount();
  },
);

test('guided Continue transfers an accepted current receipt exactly once', async () => {
  const f = await fixture(ssnCompletedSnapshot, true);
  await f.tap('onboarding-ssn-continue');
  expect(f.next).toHaveBeenCalledWith({ session: f.session, snapshot: ssnCompletedSnapshot });
  expect(f.complete).not.toHaveBeenCalled();
  await f.unmount();
  expect(f.session.release).not.toHaveBeenCalled();
  await f.session.release();
});

test('backgrounding uses native cancellation and does not start another entry or recovery', async () => {
  const spy = jest.spyOn(AppState, 'addEventListener');
  const f = await fixture();
  const change = required(spy.mock.calls.find((call) => call[0] === 'change'))[1];
  await act(async () => {
    change('background');
    await settle();
  });
  expect(f.session.ssnCancel).toHaveBeenCalledTimes(1);
  expect(f.session.ssnEntry).not.toHaveBeenCalled();
  expect(f.session.ssnRecover).not.toHaveBeenCalled();
  await f.unmount();
  spy.mockRestore();
});
