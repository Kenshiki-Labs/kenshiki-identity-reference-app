import type { CaptureSession, Configuration, SensorBoardRequest } from '@kenshiki/identity-capture';
import { useLayoutEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { sensorBoardFixture } from './__tests__/SensorBoardFixtures';
import { mockSession, required } from './__tests__/support';
import { SensorSession, useSensorSession } from './SensorScreen';
import { ControllerCustodyContext, type IdentityCustody } from './ui/ControllerCustody';

const mockCreate = jest.fn<Promise<CaptureSession>, [Configuration]>();
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: { create: (configuration: Configuration) => mockCreate(configuration) },
}));
const configuration: Configuration = {
  sensors: { directoryURL: 'file:///sensors', defaultsSuiteName: 'test', applicationIdentifier: 'test' },
};
let view: ReactTestRenderer | undefined;
let context: ReturnType<typeof useSensorSession> | undefined;
const listeners: jest.Mock[] = [];
function ObserveSession() {
  const value = useSensorSession();
  useLayoutEffect(() => {
    context = value;
    return () => {
      context = undefined;
    };
  }, [value]);
  return null;
}
const originalState = AppState.currentState;
const board = sensorBoardFixture();
function session() {
  return mockSession({
    sensorBoard: jest.fn(async (_request: SensorBoardRequest) => board),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
}
const custody = (): IdentityCustody => ({ releasing: Promise.resolve(), reportFailure: jest.fn() });
function screen(config: Configuration, owner: IdentityCustody, open = true) {
  return (
    <ControllerCustodyContext.Provider value={owner}>
      <SensorSession configuration={config} open={open}>
        <ObserveSession />
      </SensorSession>
    </ControllerCustodyContext.Provider>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockCreate.mockReset();
  listeners.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => {
    const remove = jest.fn();
    listeners.push(remove);
    return { remove };
  });
});
afterEach(async () => {
  await act(async () => view?.unmount());
  view = undefined;
  for (const remove of listeners) expect(remove).toHaveBeenCalledTimes(1);
  AppState.currentState = originalState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test.each<AppStateStatus>(['background', 'inactive', 'unknown'])(
  'mounting while %s reads status but does not collect until foreground',
  async (state) => {
    AppState.currentState = state;
    const native = session();
    mockCreate.mockResolvedValue(native);
    await act(async () => {
      view = create(screen(configuration, custody()));
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(native.sensorBoard.mock.calls.map(([request]) => request.action)).toEqual(['status']);
    const changed = required(jest.mocked(AppState.addEventListener).mock.calls[0])[1];
    await act(async () => changed('active'));
    expect(native.sensorBoard.mock.calls.map(([request]) => request.action)).toEqual(['status', 'resume']);
    await act(async () => required(view).unmount());
    view = undefined;
    expect(native.release).toHaveBeenCalledTimes(1);
  },
);
test('a replacement samples current activity after the previous owner finishes releasing', async () => {
  AppState.currentState = 'active';
  const first = session();
  const next = session();
  mockCreate.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
  const owner = custody();
  await act(async () => {
    view = create(screen(configuration, owner));
  });
  let release!: () => void;
  first.release.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => {
    required(view).update(screen({ ...configuration }, owner));
  });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  AppState.currentState = 'background';
  await act(async () => release());
  expect(mockCreate).toHaveBeenCalledTimes(2);
  expect(next.sensorBoard.mock.calls.map(([request]) => request.action)).toEqual(['status']);
  expect(first.release).toHaveBeenCalledTimes(1);
  expect(required(listeners[0])).toHaveBeenCalledTimes(1);
  await act(async () => required(view).unmount());
  view = undefined;
  expect(next.release).toHaveBeenCalledTimes(1);
});
test('a hidden sensor surface never acquires a session', async () => {
  AppState.currentState = 'active';
  mockCreate.mockResolvedValue(session());
  await act(async () => {
    view = create(screen(configuration, custody(), false));
  });
  expect(mockCreate).not.toHaveBeenCalled();
});

describe.each(['configuration replacement', 'close and reopen'])('%s', (transition) => {
  test.each(['old failure', null])(
    'a previous context cannot replace the new failure with %s',
    async (staleFailure) => {
      AppState.currentState = 'active';
      const first = session();
      const next = session();
      mockCreate.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
      const owner = custody();
      await act(async () => {
        view = create(screen(configuration, owner));
      });
      const oldSetFailure = required(context).setFailure;
      if (transition === 'close and reopen') {
        await act(async () => required(view).update(screen(configuration, owner, false)));
        await act(async () => required(view).update(screen(configuration, owner)));
      } else {
        await act(async () => required(view).update(screen({ ...configuration }, owner)));
      }
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(first.release).toHaveBeenCalledTimes(1);
      expect(required(listeners[0])).toHaveBeenCalledTimes(1);
      await act(async () => required(context).setFailure('current failure'));
      expect(required(context).failure).toBe('current failure');
      await act(async () => oldSetFailure(staleFailure));
      expect(required(context).failure).toBe('current failure');
      await act(async () => required(context).setFailure(null));
      expect(required(context).failure).toBeNull();
      await act(async () => required(view).unmount());
      view = undefined;
      expect(first.release).toHaveBeenCalledTimes(1);
      expect(next.release).toHaveBeenCalledTimes(1);
    },
  );
});

test.each(['opening failure', null])(
  'a context captured before custody opens cannot replace the live failure with %s',
  async (staleFailure) => {
    AppState.currentState = 'active';
    const native = session();
    mockCreate.mockResolvedValue(native);
    let release!: () => void;
    const owner = custody();
    owner.releasing = new Promise<void>((resolve) => {
      release = resolve;
    });
    await act(async () => {
      view = create(screen(configuration, owner));
    });
    expect(mockCreate).not.toHaveBeenCalled();
    const openingSetFailure = required(context).setFailure;
    await act(async () => release());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    await act(async () => required(context).setFailure('current failure'));
    expect(required(context).failure).toBe('current failure');
    await act(async () => openingSetFailure(staleFailure));
    expect(required(context).failure).toBe('current failure');
    await act(async () => required(context).setFailure(null));
    expect(required(context).failure).toBeNull();
    await act(async () => required(view).unmount());
    view = undefined;
    expect(native.release).toHaveBeenCalledTimes(1);
  },
);
