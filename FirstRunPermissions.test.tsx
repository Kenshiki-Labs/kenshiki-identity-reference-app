import type { Configuration, SensorBoardRequest } from '@kenshiki/identity-capture';
import { StrictMode } from 'react';
import { AppState, Linking, Settings, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { sensorBoardFixture } from './__tests__/SensorBoardFixtures';
import { invoke, required } from './__tests__/support';
import { FirstRunPermissions } from './FirstRunPermissions';
import { Action } from './ui/Action';

jest.mock('react-native/Libraries/Settings/Settings', () => ({
  default: { get: jest.fn(), set: jest.fn() },
}));

let mockBoard = sensorBoardFixture();
const mockRead = jest.fn(async (_request: SensorBoardRequest) => mockBoard);
const mockRelease = jest.fn(async () => {});
const mockCreate = jest.fn(async () => ({ sensorBoard: mockRead, release: mockRelease }));
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: { create: () => mockCreate() },
  IdentitySymbol: 'MockSymbol',
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: 'SafeAreaProvider',
  SafeAreaView: 'SafeAreaView',
}));
const configuration: Configuration = {
  sensors: { directoryURL: 'file:///synthetic', defaultsSuiteName: 'test', applicationIdentifier: 'test' },
};
let completed = false;
let view: ReactTestRenderer | undefined;
function button(id: string) {
  return required(
    required(view)
      .root.findAllByType(Action)
      .find((node) => node.props.testID === id),
  );
}
async function render() {
  await act(async () => {
    view = create(
      <FirstRunPermissions configuration={configuration} enabled>
        <Text testID="app-content">App</Text>
      </FirstRunPermissions>,
    );
  });
}
async function skipToLast() {
  await act(async () => {
    invoke(button('first-run-skip'), 'onPress');
  });
  await act(async () => {
    invoke(button('first-run-skip'), 'onPress');
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  completed = false;
  mockBoard = sensorBoardFixture();
  mockBoard.permissions = {
    motion: 'notRequested',
    bluetooth: 'notRequested',
    location: 'notRequested',
    always: false,
    precise: false,
  };
  mockRead.mockImplementation(async () => mockBoard);
  mockCreate.mockImplementation(async () => ({ sensorBoard: mockRead, release: mockRelease }));
  mockRelease.mockResolvedValue(undefined);
  jest.spyOn(Settings, 'get').mockImplementation(() => (completed ? 'completed' : undefined));
  jest.spyOn(Settings, 'set').mockImplementation(() => {
    completed = true;
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(async () => {
  await act(async () => {
    view?.unmount();
  });
  view = undefined;
  jest.useRealTimers();
  jest.restoreAllMocks();
});
test('first launch reads status without collecting or prompting; each request needs a tap', async () => {
  await render();
  expect(mockRead.mock.calls.map(([request]) => request.action)).toEqual(['status']);
  expect(required(view).root.findAllByProps({ testID: 'app-content' })).toHaveLength(0);
  await act(async () => {
    invoke(button('first-run-primary'), 'onPress');
  });
  expect(mockRead).toHaveBeenLastCalledWith({ action: 'permission', permission: 'always', consent: true });
  expect(completed).toBe(false);
  expect(JSON.stringify(required(view).toJSON())).toContain('Step 1 of 3');
});
test('continue works with denied permissions, releases the native lease, and remembers introduction', async () => {
  mockBoard.permissions.location = 'refused';
  await render();
  await skipToLast();
  await act(async () => {
    invoke(button('first-run-skip'), 'onPress');
  });
  expect(mockRelease).toHaveBeenCalledTimes(1);
  expect(Settings.set).toHaveBeenCalledTimes(1);
  expect(required(view).root.findAllByProps({ testID: 'app-content' }).length).toBeGreaterThan(0);
  await act(async () => {
    view?.unmount();
  });
  mockCreate.mockClear();
  await render();
  expect(mockCreate).not.toHaveBeenCalled();
});
test('failed release remains failed and never records completion after a repeated finish', async () => {
  mockRelease.mockRejectedValueOnce(new Error('release failed'));
  await render();
  await skipToLast();
  await act(async () => {
    invoke(button('first-run-skip'), 'onPress');
  });
  expect(completed).toBe(false);
  expect(required(view).root.findAllByProps({ testID: 'app-content' })).toHaveLength(0);
  await act(async () => {
    invoke(button('first-run-skip'), 'onPress');
  });
  expect(completed).toBe(false);
  expect(mockRelease).toHaveBeenCalledTimes(1);
});
test('reduced location accuracy is visible and opens Settings rather than claiming precise access', async () => {
  mockBoard.permissions.location = 'given';
  mockBoard.permissions.always = true;
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await render();
  await act(async () => {
    invoke(button('first-run-primary'), 'onPress');
  });
  expect(open).toHaveBeenCalledTimes(1);
  expect(mockRead.mock.calls.map(([request]) => request.action)).toEqual(['status']);
});
test('permission state is refreshed after returning from Settings', async () => {
  await render();
  mockBoard = {
    ...mockBoard,
    permissions: { ...mockBoard.permissions, location: 'given', always: true, precise: true },
  };
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  const call = required(jest.mocked(AppState.addEventListener).mock.calls[0]);
  await act(async () => {
    call[1]('active');
  });
  expect(button('first-run-primary').props.label).toBe('Next');
  expect(button('first-run-primary').props.disabled).toBe(false);
});

test('While Using does not satisfy Always; an unanswered upgrade directs the user to Settings', async () => {
  mockBoard.permissions.location = 'given';
  mockBoard.permissions.always = false;
  await render();
  expect(button('first-run-primary').props.disabled).toBe(false);
  await act(async () => {
    invoke(button('first-run-primary'), 'onPress');
  });
  expect(mockRead).toHaveBeenLastCalledWith({ action: 'permission', permission: 'always', consent: true });
  expect(button('first-run-primary').props.label).toBe('Open Settings');
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await act(async () => {
    invoke(button('first-run-primary'), 'onPress');
  });
  expect(open).toHaveBeenCalledTimes(1);
});

test('a replaced introduction cannot finish its successor or abandon the successor session', async () => {
  let finishRelease!: () => void;
  const releasing = new Promise<void>((resolve) => {
    finishRelease = resolve;
  });
  const releasePrevious = jest.fn(() => releasing);
  const releaseNext = jest.fn(async () => {});
  mockCreate
    .mockResolvedValueOnce({ sensorBoard: mockRead, release: releasePrevious })
    .mockResolvedValueOnce({ sensorBoard: mockRead, release: releaseNext });
  await render();
  await skipToLast();
  await act(async () => {
    invoke(button('first-run-skip'), 'onPress');
  });
  expect(releasePrevious).toHaveBeenCalled();
  await act(async () => {
    required(view).update(
      <FirstRunPermissions configuration={{ ...configuration }} enabled>
        <Text testID="app-content">App</Text>
      </FirstRunPermissions>,
    );
  });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishRelease();
  });
  expect(Settings.set).not.toHaveBeenCalled();
  expect(required(view).root.findAllByProps({ testID: 'app-content' })).toHaveLength(0);
  expect(mockCreate).toHaveBeenCalledTimes(2);
  await act(async () => {
    required(view).unmount();
  });
  view = undefined;
  expect(releaseNext).toHaveBeenCalledTimes(1);
});

test('replacement waits for a late creation and its release before opening another session', async () => {
  let created!: (value: Awaited<ReturnType<typeof mockCreate>>) => void;
  let released!: () => void;
  const pendingCreate = new Promise<Awaited<ReturnType<typeof mockCreate>>>((resolve) => {
    created = resolve;
  });
  const pendingRelease = new Promise<void>((resolve) => {
    released = resolve;
  });
  const releasePrevious = jest.fn(() => pendingRelease);
  mockCreate.mockReturnValueOnce(pendingCreate);
  await render();
  await act(async () => {
    required(view).update(
      <FirstRunPermissions configuration={{ ...configuration }} enabled>
        <Text testID="app-content">App</Text>
      </FirstRunPermissions>,
    );
  });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  await act(async () => {
    created({ sensorBoard: mockRead, release: releasePrevious });
  });
  expect(releasePrevious).toHaveBeenCalledTimes(1);
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledTimes(1);
  await act(async () => {
    released();
  });
  expect(mockCreate).toHaveBeenCalledTimes(2);
  expect(mockRead).toHaveBeenCalledTimes(1);
});

test('Strict Mode effect replay retains one live owner and releases it on unmount', async () => {
  await act(async () => {
    view = create(
      <StrictMode>
        <FirstRunPermissions configuration={configuration} enabled>
          <Text testID="app-content">App</Text>
        </FirstRunPermissions>
      </StrictMode>,
    );
  });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockRelease).not.toHaveBeenCalled();
  await act(async () => {
    required(view).unmount();
  });
  view = undefined;
  expect(mockRelease).toHaveBeenCalledTimes(1);
});
