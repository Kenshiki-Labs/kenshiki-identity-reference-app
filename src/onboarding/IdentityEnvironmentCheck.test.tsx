import type { EnvironmentCheckSnapshot, SSNSessionSnapshot } from '@kenshiki/identity-capture';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ssnReceipt } from '../testing/ssnFixture';
import { invoke, mockSession, settle } from '../testing/support';
import { IdentityEnvironmentCheck } from './IdentityEnvironmentCheck';
import { ControllerCustodyContext, createControllerCustody } from '../ui/ControllerCustody';
import { Page } from '../ui/Page';

jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentitySymbol: 'NativeSymbol',
}));
const idle: EnvironmentCheckSnapshot = {
  state: 'idle',
  attemptID: null,
  checkedAt: null,
  location: 'notChecked',
  air: 'notChecked',
  reason: null,
  permissions: { location: 'notRequested', motion: 'notRequested' },
};
const completed: EnvironmentCheckSnapshot = {
  ...idle,
  state: 'completed',
  attemptID: 'attempt-1',
  checkedAt: '2026-10-11T12:00:00Z',
  location: 'observed',
  air: 'consistent',
  permissions: { location: 'given', motion: 'given' },
};
const ssn: SSNSessionSnapshot = {
  state: 'completed',
  attempt: null,
  receipt: ssnReceipt,
  failure: null,
  recoveryNeeded: false,
  busy: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(snapshot = idle) {
  const session = mockSession({
    environmentSnapshot: jest.fn(async () => snapshot),
    environmentCheck: jest.fn(async () => completed),
    environmentPermission: jest.fn(async () => ({
      ...idle,
      permissions: { location: 'given' as const, motion: 'given' as const },
    })),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
  const complete = jest.fn();
  const exit = jest.fn();
  const finish = jest.fn(() => true);
  const beforeFinish = jest.fn(async () => true);
  const claim = jest.fn();
  const custody = createControllerCustody();
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <ControllerCustodyContext.Provider value={custody}>
        <IdentityEnvironmentCheck
          saved={{ session, snapshot: ssn }}
          onClaim={claim}
          onComplete={complete}
          onExit={exit}
          beforeFinish={beforeFinish}
          onFinish={finish}
        />
      </ControllerCustodyContext.Provider>,
    );
    await settle();
  });
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
  return { view, session, complete, exit, finish, beforeFinish, claim, custody, press, unmount };
}
afterEach(() => jest.restoreAllMocks());

test('opening and granting permissions never run or complete environmental verification', async () => {
  const f = await fixture();
  expect(f.claim).toHaveBeenCalledTimes(1);
  expect(f.session.environmentCheck).not.toHaveBeenCalled();
  await f.press('onboarding-environment-permission-location');
  expect(f.session.environmentPermission).toHaveBeenCalledWith('location', true);
  expect(f.session.environmentCheck).not.toHaveBeenCalled();
  expect(f.view.root.findAllByProps({ testID: 'onboarding-environment-finish' })).toHaveLength(0);
  expect(f.finish).not.toHaveBeenCalled();
  await f.unmount();
});

test.each(['consistent', 'divergent'] as const)(
  '%s stays explicit and review revalidates before exact-attempt handoff',
  async (air) => {
    const answer = { ...completed, air };
    const f = await fixture();
    f.session.environmentCheck.mockResolvedValueOnce(answer);
    await f.press('onboarding-environment-run');
    expect(f.session.environmentCheck).toHaveBeenCalledWith(true);
    expect(f.view.root.findByProps({ testID: `onboarding-environment-air-${air}` })).toBeDefined();
    expect(f.finish).not.toHaveBeenCalled();
    f.session.environmentSnapshot.mockResolvedValueOnce(answer);
    await f.press('onboarding-environment-finish');
    expect(f.beforeFinish).toHaveBeenCalledTimes(1);
    expect(f.finish).toHaveBeenCalledWith({ session: f.session, snapshot: ssn, environment: answer });
    expect(f.complete).not.toHaveBeenCalled();
    await f.unmount();
    expect(f.session.release).not.toHaveBeenCalled();
  },
);

test('unavailable observations never enable review and a new run clears earlier displayed result', async () => {
  const f = await fixture(completed);
  const pending = deferred<EnvironmentCheckSnapshot>();
  f.session.environmentCheck.mockReturnValueOnce(pending.promise);
  let checking: unknown;
  await act(async () => {
    checking = invoke(f.view.root.findByProps({ testID: 'onboarding-environment-run' }), 'onPress');
    await settle();
  });
  expect(f.view.root.findAllByProps({ testID: 'onboarding-environment-finish' })).toHaveLength(0);
  expect(f.view.root.findAllByProps({ testID: 'onboarding-environment-air-consistent' })).toHaveLength(0);
  await act(async () => {
    pending.resolve({
      ...completed,
      state: 'unavailable',
      location: 'unavailable',
      air: 'unavailable',
      reason: 'noFix',
    });
    await checking;
  });
  expect(f.view.root.findAllByProps({ testID: 'onboarding-environment-finish' })).toHaveLength(0);
  expect(f.finish).not.toHaveBeenCalled();
  await f.unmount();
});

test.each(['beforeFinish refused', 'attempt replaced', 'workspace refused'] as const)(
  'review retains native owner when %s',
  async (reason) => {
    const f = await fixture(completed);
    if (reason === 'beforeFinish refused') f.beforeFinish.mockResolvedValueOnce(false);
    if (reason === 'attempt replaced')
      f.session.environmentSnapshot.mockResolvedValueOnce({ ...completed, attemptID: 'replacement' });
    if (reason === 'workspace refused') f.finish.mockReturnValueOnce(false);
    await f.press('onboarding-environment-finish');
    expect(f.finish).toHaveBeenCalledTimes(reason === 'workspace refused' ? 1 : 0);
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.session.release).not.toHaveBeenCalled();
    await f.unmount();
    expect(f.session.release).toHaveBeenCalledTimes(1);
  },
);

test('unmount during prerequisite review cannot hand off or navigate late', async () => {
  const f = await fixture(completed);
  const pending = deferred<boolean>();
  f.beforeFinish.mockReturnValueOnce(pending.promise);
  let advancing: unknown;
  await act(async () => {
    advancing = invoke(f.view.root.findByProps({ testID: 'onboarding-environment-finish' }), 'onPress');
    await settle();
  });
  await f.unmount();
  await act(async () => {
    pending.resolve(true);
    await advancing;
  });
  expect(f.finish).not.toHaveBeenCalled();
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.exit).not.toHaveBeenCalled();
  expect(f.session.release).toHaveBeenCalledTimes(1);
});

test('Back drains one native cancellation; unmount fences its delayed answer', async () => {
  const f = await fixture();
  const pending = deferred<void>();
  f.session.cancel.mockReturnValueOnce(pending.promise);
  let closing: unknown;
  await act(async () => {
    closing = invoke(f.view.root.findByType(Page), 'onClose');
    invoke(f.view.root.findByType(Page), 'onClose');
    await settle();
  });
  expect(f.session.cancel).toHaveBeenCalledTimes(1);
  await f.unmount();
  await act(async () => {
    pending.resolve();
    await closing;
  });
  await f.custody.releasing;
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.exit).not.toHaveBeenCalled();
  expect(f.session.release).toHaveBeenCalledTimes(1);
});

test('background cancellation drains acquisition and cannot reveal its late success', async () => {
  let change: ((state: AppStateStatus) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_kind, listener) => {
    change = listener;
    return { remove: jest.fn() };
  });
  const f = await fixture();
  const pending = deferred<EnvironmentCheckSnapshot>();
  f.session.environmentCheck.mockReturnValueOnce(pending.promise);
  await act(async () => {
    invoke(f.view.root.findByProps({ testID: 'onboarding-environment-run' }), 'onPress');
    await settle();
    change?.('background');
    await settle();
  });
  expect(f.session.cancel).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve(completed);
    await settle();
    change?.('active');
  });
  expect(f.view.root.findAllByProps({ testID: 'onboarding-environment-finish' })).toHaveLength(0);
  expect(f.session.environmentCheck).toHaveBeenCalledTimes(1);
  await f.unmount();
});

test.each([
  { location: 'unavailable' as const },
  { air: 'unavailable' as const },
  { reason: 'cancelled' as const },
])('handoff refuses incomplete observation after review: %j', async (patch) => {
  const f = await fixture(completed);
  f.session.environmentSnapshot.mockResolvedValueOnce({ ...completed, ...patch });
  await f.press('onboarding-environment-finish');
  expect(f.finish).not.toHaveBeenCalled();
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.session.release).not.toHaveBeenCalled();
  await f.unmount();
  expect(f.session.release).toHaveBeenCalledTimes(1);
});
