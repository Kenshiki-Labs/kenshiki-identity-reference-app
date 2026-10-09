import type { Configuration } from '@kenshiki/identity-capture';
import { useState } from 'react';
import { Alert, AppState, Linking, Switch } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { sensorBoardFixture } from './__tests__/SensorBoardFixtures';
import { invoke, required } from './__tests__/support';
import { Action } from './IdentityCaptureFlow';
import type { SensorBoardPresentation } from './SensorBoardController';
import type { SensorPage } from './SensorPresentation';
import { SensorBoardScreen, SensorDetailScreen, SensorSession, SensorSettingsScreen } from './SensorScreen';

const mockPerform = jest.fn(async () => {});
const mockDispose = jest.fn(async () => {});
const mockSetActive = jest.fn(async () => {});
const mockOpen = jest.fn(async () => {});
let mockBoard = sensorBoardFixture();
jest.mock('./SensorBoardController', () => ({
  SensorBoardController: jest
    .fn()
    .mockImplementation((_config: Configuration, changed: (value: SensorBoardPresentation) => void) => ({
      open: async () => {
        await mockOpen();
        changed({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' });
      },
      dispose: mockDispose,
      perform: mockPerform,
      setActive: mockSetActive,
    })),
}));
jest.mock('@kenshiki/identity-capture', () => ({
  IdentitySensorMap: 'SensorMap',
  IdentitySensorSymbol: 'SensorSymbol',
}));
const configuration: Configuration = {};
function button(view: ReactTestRenderer, label: string) {
  return required(view.root.findAllByType(Action).find((node) => node.props.label === label));
}
/** Stands in for the navigation stack: the board pushes a detail page or the settings screen, and
 * every screen shares the one session, as the pushed screens do in App. */
function Screens({ initial }: { initial: 'board' | 'settings' }) {
  const [page, setPage] = useState<SensorPage | null>(null);
  return (
    <SensorSession configuration={configuration} open>
      {initial === 'settings' ? (
        <SensorSettingsScreen />
      ) : page ? (
        <SensorDetailScreen page={page} />
      ) : (
        <SensorBoardScreen onOpenPage={setPage} />
      )}
    </SensorSession>
  );
}
async function render(initial: 'board' | 'settings' = 'board') {
  let view: ReactTestRenderer | undefined;
  await act(async () => {
    view = create(<Screens initial={initial} />);
  });
  return required(view);
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  mockBoard = sensorBoardFixture();
});
test('renders all sensor sections, location map and navigable documentation; releases its owner', async () => {
  const view = await render();
  for (const label of [
    'Status',
    'Audio route',
    'Barometer',
    'Bluetooth',
    'Calls',
    'Network',
    'Device',
    'Location',
    'Magnetic field',
    'Motion',
    'Mobile network',
    'Battery and heat',
    'Weather',
  ])
    expect(button(view, `About ${label}`)).toBeDefined();
  await act(async () => {
    invoke(button(view, 'Get one fix'), 'onPress');
  });
  expect(mockPerform).toHaveBeenCalledWith({ action: 'location', consent: true });
  await act(async () => {
    invoke(button(view, 'About Location'), 'onPress');
  });
  const detail = view.root.findByProps({ testID: 'sensor-detail' });
  expect(JSON.stringify(view.toJSON())).toContain('Apple APIs');
  expect(detail.findAll((node) => node.props.label === 'About Motion')).toHaveLength(0);
  expect(mockOpen).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
  expect(mockDispose).toHaveBeenCalledTimes(1);
});
test('permission switch requests once or opens OS Settings; destructive erase requires confirmation', async () => {
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = await render('settings');
  const motion = required(
    view.root.findAllByType(Switch).find((node) => node.props.accessibilityLabel === 'Motion & Fitness'),
  );
  await act(async () => {
    invoke(motion, 'onValueChange', true);
  });
  expect(mockPerform).toHaveBeenCalledWith({ action: 'permission', consent: true, permission: 'motion' });
  await act(async () => {
    invoke(motion, 'onValueChange', false);
  });
  expect(settings).toHaveBeenCalledTimes(1);
  await act(async () => {
    invoke(button(view, 'Erase local sensor data'), 'onPress');
  });
  expect(alert).toHaveBeenCalled();
  expect(mockPerform).not.toHaveBeenCalledWith({ action: 'erase', consent: true });
  await act(async () => view.unmount());
  settings.mockRestore();
  alert.mockRestore();
});
test('permission-prompt inactive state does not pause; background does', async () => {
  const listener = jest.spyOn(AppState, 'addEventListener');
  const view = await render();
  const callback = required(listener.mock.calls[0])[1];
  await act(async () => callback('inactive'));
  expect(mockSetActive).not.toHaveBeenCalled();
  await act(async () => callback('background'));
  expect(mockSetActive).toHaveBeenCalledWith(false);
  await act(async () => callback('active'));
  expect(mockSetActive).toHaveBeenCalledWith(true);
  await act(async () => view.unmount());
  listener.mockRestore();
});

test('location retains native acceptance, source and delivery evidence; clear affects only the trail action', async () => {
  mockBoard.location.fix = {
    id: 'fix-1',
    latitude: 37.123456789,
    longitude: -122.123456789,
    horizontalAccuracy: 8,
    verticalAccuracy: -1,
    altitude: null,
    speed: null,
    course: null,
    measuredAt: new Date().toISOString(),
    simulated: false,
    accessory: true,
    precise: true,
    accepted: false,
    unmetTerms: ['finiteTimestamp'],
  };
  mockBoard.location.deliveredCount = 3;
  mockBoard.location.permissionAtDelivery = 'given';
  mockBoard.location.precisionAtDelivery = 'fullAccuracy';
  mockBoard.location.trail = [mockBoard.location.fix];
  mockBoard.location.estimateID = 'fix-1';
  const view = await render();
  const rendered = JSON.stringify(view.toJSON());
  expect(rendered).toContain('37.123456789');
  expect(rendered).toContain('Not valid');
  expect(rendered).toContain('No real time');
  expect(rendered).toContain('Positions received');
  await act(async () => {
    invoke(button(view, 'Clear'), 'onPress');
  });
  expect(mockPerform).toHaveBeenCalledWith({ action: 'clearTrail', consent: true });
  await act(async () => view.unmount());
});
