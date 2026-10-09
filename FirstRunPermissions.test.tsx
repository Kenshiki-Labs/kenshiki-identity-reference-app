import type { Configuration, SensorBoardRequest } from '@kenshiki/identity-capture';
import { AppState, Linking, Settings, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { sensorBoardFixture } from './__tests__/SensorBoardFixtures';
import { invoke, required } from './__tests__/support';
import { FirstRunPermissions } from './FirstRunPermissions';
import { ButtonRow } from './ui/List';

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
      .root.findAllByType(ButtonRow)
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
    invoke(button('first-run-location'), 'onPress');
  });
  expect(mockRead).toHaveBeenLastCalledWith({ action: 'permission', permission: 'always', consent: true });
  expect(completed).toBe(false);
});
test('continue works with denied permissions, releases the native lease, and remembers introduction', async () => {
  mockBoard.permissions.location = 'refused';
  await render();
  await act(async () => {
    invoke(button('first-run-continue'), 'onPress');
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
test('failed release leaves the introduction visible and does not record completion', async () => {
  mockRelease.mockRejectedValueOnce(new Error('release failed'));
  await render();
  await act(async () => {
    invoke(button('first-run-continue'), 'onPress');
  });
  expect(completed).toBe(false);
  expect(required(view).root.findAllByProps({ testID: 'app-content' })).toHaveLength(0);
  await act(async () => {
    invoke(button('first-run-continue'), 'onPress');
  });
  expect(completed).toBe(true);
});
test('reduced location accuracy is visible and opens Settings rather than claiming precise access', async () => {
  mockBoard.permissions.location = 'given';
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await render();
  await act(async () => {
    invoke(button('first-run-precise'), 'onPress');
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
  expect(button('first-run-location').props.label).toBe('Allowed');
  expect(button('first-run-location').props.disabled).toBe(true);
});

test('While Using does not satisfy Always; an unanswered upgrade directs the user to Settings', async () => {
  mockBoard.permissions.location = 'given';
  mockBoard.permissions.always = false;
  await render();
  expect(button('first-run-location').props.disabled).toBe(false);
  await act(async () => {
    invoke(button('first-run-location'), 'onPress');
  });
  expect(mockRead).toHaveBeenLastCalledWith({ action: 'permission', permission: 'always', consent: true });
  expect(button('first-run-location').props.label).toBe('Open Settings');
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await act(async () => {
    invoke(button('first-run-location'), 'onPress');
  });
  expect(open).toHaveBeenCalledTimes(1);
});
