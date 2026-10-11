import type { CaptureSession, Configuration, SensorBoardRequest } from '@kenshiki/identity-capture';
import { type NavigationContainerRef, type ParamListBase, useNavigation } from '@react-navigation/native';
import { useLayoutEffect } from 'react';
import { AppState } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { sensorBoardFixture } from './__tests__/SensorBoardFixtures';
import { invoke, mockSession, property, required } from './__tests__/support';
import { AppNavigator } from './AppNavigator';
import { AppContainer } from './ui/AppContainer';

// Keep the real navigation tree, session adapter and sensor controller. Capture content is
// outside this boundary; these leaves must not acquire additional mocked native sessions.
jest.mock('./IdentityCaptureFlow', () => ({ IdentityCaptureFlow: () => null }));
jest.mock('./DriverLicenseFlow', () => ({ DriverLicenseFlow: () => null }));
jest.mock('./PhoneFlow', () => ({ PhoneFlow: () => null }));
jest.mock('./SSNFlow', () => ({ SSNFlow: () => null }));
jest.mock('./IntegrationChecks', () => ({ IntegrationChecks: () => null }));
const mockCreate = jest.fn<Promise<CaptureSession>, [Configuration]>();
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: { create: (configuration: Configuration) => mockCreate(configuration) },
  IdentitySensorMap: 'SensorMap',
  IdentitySensorSymbol: 'SensorSymbol',
  IdentitySymbol: 'MockSymbol',
}));
const configuration: Configuration = {
  sensors: { directoryURL: 'file:///sensors', defaultsSuiteName: 'test', applicationIdentifier: 'test' },
};
let navigation: NavigationContainerRef<ParamListBase> | undefined;
let view: ReactTestRenderer | undefined;
const originalState = AppState.currentState;
function NavigationObserver() {
  const root = useNavigation<NavigationContainerRef<ParamListBase>>();
  useLayoutEffect(() => {
    navigation = root;
    return () => {
      navigation = undefined;
    };
  }, [root]);
  return null;
}
function app(config = configuration) {
  return (
    <AppContainer configuration={config}>
      <NavigationObserver />
      <AppNavigator configuration={config} developerChecks />
    </AppContainer>
  );
}
function session() {
  return mockSession({
    sensorBoard: jest.fn(async (_request: SensorBoardRequest) => sensorBoardFixture()),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
}
const sessions: ReturnType<typeof session>[] = [];
async function tab(screen: string, child?: string) {
  await act(async () => {
    required(navigation).navigate('Tabs', {
      screen,
      ...(child ? { params: { screen: child } } : {}),
    });
  });
}
async function back() {
  await act(async () => required(navigation).goBack());
}
beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  AppState.currentState = 'active';
  sessions.length = 0;
  mockCreate.mockImplementation(async () => {
    const next = session();
    sessions.push(next);
    return next;
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  await act(async () => {
    view = create(app());
  });
});
afterEach(async () => {
  await act(async () => view?.unmount());
  view = undefined;
  AppState.currentState = originalState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('ready opens Fusion, sensor and settings surfaces share collection, and identity closes it', async () => {
  expect(required(navigation).isReady()).toBe(true);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(required(sessions[0]).sensorBoard.mock.calls.map(([request]) => request.action)).toEqual([
    'status',
    'resume',
  ]);
  await tab('SensorsTab');
  await tab('SettingsTab');
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(required(sessions[0]).release).not.toHaveBeenCalled();
  await tab('IdentityTab');
  expect(required(sessions[0]).release).toHaveBeenCalledTimes(1);
  await tab('FusionTab');
  expect(mockCreate).toHaveBeenCalledTimes(2);
});
test.each(['AirCheck', 'Continuity', 'OverTime', 'ThreeProofs'])(
  'Fusion %s keeps its sensor state available without replacing the owner',
  async (destination) => {
    await tab('FusionTab', destination);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(required(sessions[0]).release).not.toHaveBeenCalled();
    await back();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  },
);
test('sensor detail survives a tab round trip and native Back returns within Sensors', async () => {
  await tab('SensorsTab');
  await act(async () => {
    required(navigation).navigate('Tabs', {
      screen: 'SensorsTab',
      params: { screen: 'SensorDetail', params: { page: 'motion' } },
    });
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('SensorDetail');
  const detailKey = required(navigation).getCurrentRoute()?.key;
  await tab('SettingsTab');
  await tab('SensorsTab');
  expect(required(navigation).getCurrentRoute()?.key).toBe(detailKey);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(required(sessions[0]).release).not.toHaveBeenCalled();
  await act(async () => {
    const detailScreen = required(
      required(view)
        .root.findAll(
          (node) =>
            typeof node.props.onHeaderBackButtonClicked === 'function' &&
            node.findAllByProps({ testID: 'sensor-detail' }).length > 0,
        )
        .at(-1),
    );
    invoke(detailScreen, 'onHeaderBackButtonClicked');
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('SensorBoard');
  expect(mockCreate).toHaveBeenCalledTimes(1);
});
test('the static Glossary releases collection, and back acquires a fresh owner', async () => {
  await tab('FusionTab', 'Glossary');
  expect(required(sessions[0]).release).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(5000));
  expect(required(sessions[0]).sensorBoard.mock.calls.map(([request]) => request.action)).toEqual([
    'status',
    'resume',
  ]);
  await back();
  expect(mockCreate).toHaveBeenCalledTimes(2);
});
test('DeveloperChecks releases Settings collection and back starts it again', async () => {
  await tab('SettingsTab');
  await tab('SettingsTab', 'DeveloperChecks');
  expect(required(sessions[0]).release).toHaveBeenCalledTimes(1);
  await back();
  expect(mockCreate).toHaveBeenCalledTimes(2);
});
test.each(['PassportCapture', 'LicenseCapture'])(
  'root modal %s releases sensors and dismissal resumes the visible tab',
  async (route) => {
    await act(async () => required(navigation).navigate(route));
    expect(required(sessions[0]).release).toHaveBeenCalledTimes(1);
    await back();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  },
);
test('rapid navigation cannot acquire while release is pending or revive a hidden surface', async () => {
  let release!: () => void;
  required(sessions[0]).release.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await tab('IdentityTab');
  await tab('SensorsTab');
  expect(mockCreate).toHaveBeenCalledTimes(1);
  await tab('IdentityTab');
  await act(async () => release());
  expect(mockCreate).toHaveBeenCalledTimes(1);
  await tab('SensorsTab');
  expect(mockCreate).toHaveBeenCalledTimes(2);
});
test('rerendering the same configuration preserves the selected route and sensor owner', async () => {
  await tab('SensorsTab');
  await act(async () => {
    required(navigation).navigate('Tabs', {
      screen: 'SensorsTab',
      params: { screen: 'SensorDetail', params: { page: 'motion' } },
    });
  });
  const previousNavigation = required(navigation);
  const detailKey = previousNavigation.getCurrentRoute()?.key;
  await act(async () => required(view).update(app()));
  expect(navigation).toBe(previousNavigation);
  expect(required(navigation).getCurrentRoute()?.key).toBe(detailKey);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(required(sessions[0]).release).not.toHaveBeenCalled();
});
test('configuration reset discards old routes and waits for release before the new initial tab opens', async () => {
  const previousNavigation = required(navigation);
  let release!: () => void;
  required(sessions[0]).release.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await tab('FusionTab', 'Glossary');
  const replacement: Configuration = {
    sensors: { ...required(configuration.sensors), defaultsSuiteName: 'replacement' },
  };
  await act(async () => required(view).update(app(replacement)));
  expect(navigation).not.toBe(previousNavigation);
  expect(required(navigation).getCurrentRoute()?.name).toBe('FusionHome');
  expect(mockCreate).toHaveBeenCalledTimes(1);
  await act(async () => release());
  expect(mockCreate).toHaveBeenLastCalledWith({ sensors: replacement.sensors });
  expect(mockCreate).toHaveBeenCalledTimes(2);
  await act(async () => required(view).unmount());
  expect(required(sessions[1]).release).toHaveBeenCalledTimes(1);
  expect(navigation).toBeUndefined();
  view = undefined;
});

test.each(['LicenseDetail', 'PassportDetail', 'FaceDetail', 'PhoneDetail', 'SSNDetail'])(
  '%s is a native Identity detail route, not a root modal',
  async (detail) => {
    await tab('IdentityTab');
    await tab('IdentityTab', detail);
    const root = required(required(navigation).getRootState());
    expect(root.routes.map((route) => route.name)).toEqual(['Tabs']);
    expect(required(navigation).getCurrentRoute()?.name).toBe(detail);
    const screen = required(
      required(view)
        .root.findAll(
          (node) =>
            node.props.focused === true && node.props.index > 0 && property(node, 'descriptor') !== undefined,
        )
        .at(-1),
    );
    expect(property(screen, 'descriptor')).toMatchObject({
      route: { name: detail },
      options: { headerShown: true },
    });
    expect(property(screen, 'descriptor')).not.toMatchObject({
      options: { presentation: 'fullScreenModal' },
    });
    await back();
    expect(required(navigation).getCurrentRoute()?.name).toBe('IdentityHome');
  },
);
