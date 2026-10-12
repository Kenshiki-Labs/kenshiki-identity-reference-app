import type { CaptureSession, Configuration, SensorBoardRequest } from '@kenshiki/identity-capture';
import { type NavigationContainerRef, type ParamListBase, useNavigation } from '@react-navigation/native';
import { useLayoutEffect } from 'react';
import { AppState, Linking, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { sensorBoardFixture } from '../testing/SensorBoardFixtures';
import { invoke, mockSession, nativeBack, property, required } from '../testing/support';
import { AppNavigator } from './AppNavigator';
import { copy, hasDocumentation, pages, title } from '../sensors/SensorPresentation';
import { SensorSettingsScreen } from '../sensors/SensorScreen';
import { Action } from '../ui/Action';
import { AppContainer } from '../ui/AppContainer';
import { LinkRow, ListRow, ListSection } from '../ui/List';
import { PageLead } from '../ui/PageLead';

// Keep the real navigation tree, session adapter and sensor controller. Capture content is
// outside this boundary; these leaves must not acquire additional mocked native sessions.
jest.mock('../identity/IdentityCaptureFlow', () => ({ IdentityCaptureFlow: () => null }));
jest.mock('../identity/DriverLicenseFlow', () => ({ DriverLicenseFlow: () => null }));
jest.mock('../identity/PhoneFlow', () => ({ PhoneFlow: () => null }));
jest.mock('../identity/SSNFlow', () => ({ SSNFlow: () => null }));
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
test('the Three Proofs disclosure pushes the native detail and Back returns to Fusion without sensor commands', async () => {
  const owner = required(sessions[0]);
  owner.sensorBoard.mockClear();
  const row = required(
    required(view)
      .root.findAllByType(ListRow)
      .find((node) => property(node, 'label') === 'What each proof carries, and how they join'),
  );
  await act(async () => {
    invoke(row, 'onPress');
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('ThreeProofs');
  expect(required(view).root.findAllByProps({ testID: 'fusion-proofs' }).length).toBeGreaterThan(0);
  const screen = required(
    required(view)
      .root.findAll(
        (node) =>
          node.props.focused === true && node.props.index > 0 && property(node, 'descriptor') !== undefined,
      )
      .at(-1),
  );
  expect(property(screen, 'descriptor')).toMatchObject({
    route: { name: 'ThreeProofs' },
    options: { title: 'Three proofs', headerShown: true, headerTransparent: false },
  });
  await act(async () => {
    nativeBack(required(view));
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('FusionHome');
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(owner.release).not.toHaveBeenCalled();
  expect(owner.sensorBoard).not.toHaveBeenCalled();
});
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
  const row = required(
    required(view)
      .root.findAllByType(ListRow)
      .find((node) => property(node, 'label') === 'Words used here'),
  );
  await act(async () => {
    invoke(row, 'onPress');
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('Glossary');
  expect(required(sessions[0]).release).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(5000));
  expect(required(sessions[0]).sensorBoard.mock.calls.map(([request]) => request.action)).toEqual([
    'status',
    'resume',
  ]);
  await act(async () => {
    nativeBack(required(view));
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('FusionHome');
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

test.each([
  ['FusionTab', 'FusionHome', 'What the readings tell you'],
  ['SensorsTab', 'SensorBoard', 'What your phone can observe'],
  ['IdentityTab', 'IdentityHome', 'Your identity checks'],
  ['SettingsTab', 'SettingsHome', 'Manage readings and saved evidence'],
  ['IdentityTab', 'LicenseDetail', 'Your license or state ID'],
  ['IdentityTab', 'PassportDetail', 'Your passport evidence'],
  ['IdentityTab', 'FaceDetail', 'Your face comparison'],
  ['IdentityTab', 'PhoneDetail', 'Complete the earlier checks'],
  ['IdentityTab', 'SSNDetail', 'Complete the earlier checks'],
])('%s / %s exposes its own lead through the actual navigator', async (tabName, route, headline) => {
  await tab(tabName, route);
  expect(required(navigation).getCurrentRoute()?.name).toBe(route);
  const leads = required(view)
    .root.findAllByType(PageLead)
    .filter((node) => property(node, 'title') === headline);
  expect(leads).toHaveLength(1);
  expect(property(required(leads[0]), 'description')).toEqual(expect.any(String));
});

test.each(pages.filter(hasDocumentation))(
  'sensor %s pushes API documentation and native Back restores the same L2',
  async (page) => {
    await tab('SensorsTab');
    const owner = required(sessions[0]);
    owner.sensorBoard.mockClear();
    const row = (label: string) =>
      required(
        required(view)
          .root.findAllByType(ListRow)
          .find((node) => property(node, 'label') === label),
      );
    await act(async () => {
      invoke(row(title(page)), 'onPress');
    });
    const detail = required(navigation).getCurrentRoute();
    expect(detail).toMatchObject({ name: 'SensorDetail', params: { page } });
    await act(async () => {
      invoke(row('API documentation'), 'onPress');
    });
    expect(required(navigation).getCurrentRoute()).toMatchObject({
      name: 'SensorDocumentation',
      params: { page },
    });
    expect(required(view).root.findAllByProps({ testID: 'sensor-documentation' }).length).toBeGreaterThan(0);
    await tab('SettingsTab');
    await tab('SensorsTab');
    expect(required(navigation).getCurrentRoute()).toMatchObject({
      name: 'SensorDocumentation',
      params: { page },
    });
    await act(async () => {
      nativeBack(required(view));
    });
    expect(required(navigation).getCurrentRoute()?.key).toBe(detail?.key);
    await act(async () => {
      nativeBack(required(view));
    });
    expect(required(navigation).getCurrentRoute()?.name).toBe('SensorBoard');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(owner.release).not.toHaveBeenCalled();
    expect(owner.sensorBoard).not.toHaveBeenCalled();
  },
);

test('Settings groups preferences before data actions and diagnostics, with quiet headings', async () => {
  await tab('SettingsTab');
  const sections = required(view)
    .root.findByType(SensorSettingsScreen)
    .findAllByType(ListSection)
    .filter((node) => property(node, 'header'));
  const headings = sections.map((node) => property(node, 'header'));
  expect(headings.slice(0, 5)).toEqual(
    ['units', 'permissions', 'captureWindows', 'export', 'erase'].map((key) => copy(`${key}.header`)),
  );
  expect(headings.indexOf('Saved identity data')).toBeGreaterThan(headings.indexOf(copy('erase.header')));
  expect(headings.indexOf('Saved identity data')).toBeLessThan(headings.indexOf(copy('environment.header')));
  for (const section of sections) expect(property(section, 'headerIcon')).toBeUndefined();
  expect(required(sessions[0]).release).not.toHaveBeenCalled();
});

test('Air Check disclosure acquires once and native Back returns to Fusion without another check', async () => {
  const owner = required(sessions[0]);
  owner.sensorBoard.mockClear();
  const row = required(
    required(view)
      .root.findAllByType(ListRow)
      .find((node) => property(node, 'label') === 'Air check'),
  );
  await act(async () => {
    invoke(row, 'onPress');
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('AirCheck');
  expect(owner.sensorBoard.mock.calls.filter(([request]) => request.action === 'airCheck')).toHaveLength(1);
  await act(async () => {
    nativeBack(required(view));
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('FusionHome');
  expect(owner.sensorBoard.mock.calls.filter(([request]) => request.action === 'airCheck')).toHaveLength(1);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(owner.release).not.toHaveBeenCalled();
});

test('Continuity and Over Time disclosures preserve the native back chain without evaluating', async () => {
  const owner = required(sessions[0]);
  owner.sensorBoard.mockClear();
  const row = (label: string) =>
    required(
      required(view)
        .root.findAllByType(ListRow)
        .find((node) => property(node, 'label') === label),
    );
  await act(async () => {
    invoke(row('Continuity'), 'onPress');
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('Continuity');
  const key = required(navigation).getCurrentRoute()?.key;
  await act(async () => {
    invoke(row('How this behaves over time'), 'onPress');
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('OverTime');
  await act(async () => {
    nativeBack(required(view));
  });
  expect(required(navigation).getCurrentRoute()?.key).toBe(key);
  await act(async () => {
    nativeBack(required(view));
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('FusionHome');
  expect(owner.sensorBoard).not.toHaveBeenCalled();
  expect(owner.release).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

test('Status disclosure and native Back preserve collection without an empty documentation destination', async () => {
  await tab('SensorsTab');
  const owner = required(sessions[0]);
  owner.sensorBoard.mockClear();
  const row = required(
    required(view)
      .root.findAllByType(ListRow)
      .find((node) => property(node, 'label') === 'Status'),
  );
  await act(async () => {
    invoke(row, 'onPress');
  });
  expect(required(navigation).getCurrentRoute()).toMatchObject({
    name: 'SensorDetail',
    params: { page: 'status' },
  });
  const detail = required(required(view).root.findAllByProps({ testID: 'sensor-detail' }).at(-1));
  expect(detail.findAllByType(ListRow)).toHaveLength(0);
  await act(async () => {
    nativeBack(required(view));
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('SensorBoard');
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(owner.release).not.toHaveBeenCalled();
  expect(owner.sensorBoard).not.toHaveBeenCalled();
});

test('Identity onboarding opens Welcome without collecting evidence and Back preserves individual checks', async () => {
  await tab('IdentityTab');
  const acquisitions = mockCreate.mock.calls.length;
  const home = required(required(view).root.findAllByProps({ testID: 'identity-hub' }).at(-1));
  const rows = home.findAllByType(ListRow);
  expect(rows.map((row) => property(row, 'rowID')).slice(0, 6)).toEqual([
    'open-identity-welcome',
    'open-driver-license',
    'open-capture-flow',
    'face-match-card',
    'open-phone',
    'open-ssn',
  ]);
  const sections = home.findAllByType(ListSection);
  expect(sections.map((section) => property(section, 'header')).slice(0, 2)).toEqual([
    'Guided verification',
    'Individual checks',
  ]);
  expect(
    required(sections[0])
      .findAllByType(ListRow)
      .map((row) => property(row, 'rowID')),
  ).toEqual(['open-identity-welcome']);
  const entry = required(rows[0]);
  await act(async () => {
    invoke(entry, 'onPress');
  });
  expect(required(navigation).getCurrentRoute()).toMatchObject({ name: 'IdentityWelcome' });
  expect(required(navigation).getCurrentRoute()?.params).toBeUndefined();
  const welcome = required(required(view).root.findAllByProps({ testID: 'identity-welcome' }).at(-1));
  expect(welcome.findAllByType(PageLead).map((lead) => property(lead, 'title'))).toEqual([
    'Verify your identity',
  ]);
  const start = required(welcome.findAllByProps({ testID: 'onboarding-start' }).at(-1));
  expect(property(start, 'accessibilityState')).toEqual({ disabled: false });
  await act(async () => jest.advanceTimersByTime(5000));
  expect(mockCreate).toHaveBeenCalledTimes(acquisitions);
  await act(async () => {
    nativeBack(required(view));
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('IdentityHome');
  expect(mockCreate).toHaveBeenCalledTimes(acquisitions);
  const license = required(
    required(view)
      .root.findAllByType(ListRow)
      .find((row) => property(row, 'rowID') === 'open-driver-license'),
  );
  await act(async () => {
    invoke(license, 'onPress');
  });
  expect(required(navigation).getCurrentRoute()?.name).toBe('LicenseDetail');
});

test('Welcome policy links use fixed public URLs and failed opening stays recoverable without exposing errors', async () => {
  await tab('IdentityTab', 'IdentityWelcome');
  const acquisitions = mockCreate.mock.calls.length;
  const openURL = jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValueOnce(new Error('private-holder-and-native-diagnostics'))
    .mockResolvedValue(undefined);
  const welcome = required(required(view).root.findAllByProps({ testID: 'identity-welcome' }).at(-1));
  const links = welcome.findAllByType(LinkRow);
  expect(links.map((link) => property(link, 'caption'))).toEqual(['Terms of Use', 'Privacy Notice']);
  await act(async () => {
    invoke(required(links[0]), 'onPress');
  });
  expect(openURL).toHaveBeenLastCalledWith('https://kenshikilabs.com/terms');
  expect(
    welcome
      .findAllByType(Text)
      .some((node) => property(node, 'children') === 'Couldn’t open this page. Please try again.'),
  ).toBe(true);
  expect(JSON.stringify(required(view).toJSON())).not.toContain('private-holder');
  await act(async () => {
    invoke(required(links[0]), 'onPress');
  });
  expect(welcome.findAllByProps({ accessibilityRole: 'alert' })).toHaveLength(0);
  await act(async () => {
    invoke(required(links[1]), 'onPress');
  });
  expect(openURL.mock.calls.map(([url]) => url)).toEqual([
    'https://kenshikilabs.com/terms',
    'https://kenshikilabs.com/terms',
    'https://kenshikilabs.com/privacy',
  ]);
  expect(mockCreate).toHaveBeenCalledTimes(acquisitions);
  expect(required(navigation).getCurrentRoute()?.name).toBe('IdentityWelcome');
});

async function pressOnboarding(id: string) {
  const button = required(
    required(view)
      .root.findAllByProps({ testID: id })
      .filter((node) => typeof property(node, 'onPress') === 'function')
      .at(-1),
  );
  await act(async () => {
    invoke(button, 'onPress');
  });
}

function expectDocumentSelection(document: 'passport' | 'license') {
  for (const option of ['passport', 'license']) {
    const radio = required(
      required(view)
        .root.findAllByProps({ testID: `choose-${option}` })
        .filter((node) => property(node, 'accessibilityRole') === 'radio')
        .at(-1),
    );
    expect(property(radio, 'accessibilityState')).toMatchObject({ checked: option === document });
  }
}

test.each(['passport', 'license'] as const)(
  'guided %s preparation follows the native stack and Back preserves document choice without capture',
  async (document) => {
    await tab('IdentityTab');
    const acquisitions = mockCreate.mock.calls.length;
    jest.clearAllMocks();
    await pressOnboarding('open-identity-welcome');
    const welcomeKey = required(navigation).getCurrentRoute()?.key;
    await pressOnboarding('onboarding-start');
    expect(required(navigation).getCurrentRoute()?.name).toBe('IdentityChooseID');
    expect(required(navigation).getCurrentRoute()?.params).toBeUndefined();
    const choiceKey = required(navigation).getCurrentRoute()?.key;
    expectDocumentSelection('passport');
    await pressOnboarding(`choose-${document}`);
    expectDocumentSelection(document);
    await pressOnboarding('onboarding-continue');
    expect(required(navigation).getCurrentRoute()?.name).toBe('IdentityPreparation');
    expect(required(navigation).getCurrentRoute()?.params).toEqual({ document });
    const preparation = required(
      required(view).root.findAllByProps({ testID: 'identity-preparation' }).at(-1),
    );
    const capture = required(preparation.findAllByProps({ testID: 'onboarding-capture' }).at(-1));
    expect(property(capture, 'accessibilityState')).toMatchObject({ disabled: document === 'passport' });
    const captureAction = required(
      preparation.findAllByType(Action).find((node) => property(node, 'testID') === 'onboarding-capture'),
    );
    expect(property(captureAction, 'disabled')).toBe(document === 'passport');
    expect(required(required(navigation).getRootState()).routes.map((route) => route.name)).toEqual(['Tabs']);
    await act(async () => jest.advanceTimersByTime(5000));
    expect(mockCreate).not.toHaveBeenCalled();
    for (const owner of sessions) {
      for (const operation of Object.values(owner)) {
        if (jest.isMockFunction(operation)) expect(operation).not.toHaveBeenCalled();
      }
    }
    expect(sessions).toHaveLength(acquisitions);
    await act(async () => {
      nativeBack(required(view));
    });
    expect(required(navigation).getCurrentRoute()?.key).toBe(choiceKey);
    expectDocumentSelection(document);
    const alternative = document === 'passport' ? 'license' : 'passport';
    await pressOnboarding(`choose-${alternative}`);
    await pressOnboarding('onboarding-continue');
    expect(required(navigation).getCurrentRoute()?.params).toEqual({ document: alternative });
    await act(async () => {
      nativeBack(required(view));
    });
    expectDocumentSelection(alternative);
    await act(async () => {
      nativeBack(required(view));
    });
    expect(required(navigation).getCurrentRoute()?.key).toBe(welcomeKey);
    await act(async () => {
      nativeBack(required(view));
    });
    expect(required(navigation).getCurrentRoute()?.name).toBe('IdentityHome');
    expect(mockCreate).not.toHaveBeenCalled();
  },
);
