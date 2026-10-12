import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { sensorBoardFixture } from '../testing/SensorBoardFixtures';
import { invoke, property, required } from '../testing/support';
import { weatherRows } from './SensorBoardLocation';
import { moment } from './SensorPresentation';
import { ButtonRow, TextRow, ValueRow } from '../ui/List';

jest.mock('@kenshiki/identity-capture', () => ({ IdentitySensorMap: 'SensorMap' }));

test('weather preserves provider evidence and separates report states through failure and retry', async () => {
  const board = sensorBoardFixture();
  board.units = 'metric';
  board.weather = {
    ...board.weather,
    state: 'available',
    pressureKPa: 0,
    temperatureC: 0,
    humidityPercent: 0,
    distanceMeters: 0,
    stationElevationMeters: 0,
    stationName: 'Office_Station',
    stationID: 'given',
    quality: 'given',
    source: 'https://provider.test/camelCase_report',
    observedAt: '2026-10-11T12:00:00Z',
    readAt: '2026-10-11T12:30:00Z',
    details: ['provider_detail', 'provider_detail', 'Second detail.'],
  };
  const perform = jest.fn();
  let busy = false;
  let sessionId: string | null = 'weather-session';
  let view!: ReactTestRenderer;
  const content = () => <>{weatherRows({ board, busy, sessionId, perform })}</>;
  await act(async () => {
    view = create(content());
  });
  const publish = async () => {
    await act(async () => {
      view.update(content());
    });
  };
  const rows = () =>
    view.root.findAllByType(ValueRow).map((node) => [property(node, 'label'), property(node, 'value')]);
  const value = (label: string) => required(rows().find((row) => row[0] === label))[1];
  const button = () => view.root.findByType(ButtonRow);
  expect(perform).not.toHaveBeenCalled();
  expect(rows().slice(0, 3)).toEqual([
    ['Report', 'Report available'],
    ['Observed at', moment(board.weather.observedAt)],
    ['Pressure', '0 hPa'],
  ]);
  expect(value('Read at')).toBe(moment(board.weather.readAt));
  expect(value('Temperature')).toBe('0 °C');
  expect(value('Humidity')).toBe('0 %');
  expect(value('Distance')).toBe('0 m');
  expect(value('Station height')).toBe('0 m');
  expect(value('Station')).toContain('Office_Station');
  expect(value('Station')).toContain('given');
  expect(value('Quality')).toBe('given');
  expect(value('Source')).toBe('https://provider.test/camelCase_report');
  expect(view.root.findAllByType(TextRow).map((node) => property(node, 'text'))).toEqual([
    'provider_detail',
    'Second detail.',
  ]);
  board.units = 'imperial';
  board.weather.pressureKPa = 100;
  board.weather.distanceMeters = 1;
  await publish();
  expect(value('Pressure')).toBe('29.53 inHg');
  expect(value('Temperature')).toBe('32 °F');
  expect(value('Distance')).toBe('3.281 ft');
  board.weather.humidityPercent = null;
  board.weather.quality = null;
  board.weather.source = '';
  await publish();
  expect(value('Humidity')).toBe('—');
  expect(value('Quality')).toBe('—');
  expect(value('Source')).toBe('—');
  for (const [state, label] of [
    ['notRequested', 'Not requested'],
    ['failed', 'Report unavailable'],
    ['notConfigured', 'Not configured'],
  ] as const) {
    board.weather.state = state;
    board.weather.failure = null;
    await publish();
    expect(rows()).toEqual([
      ['Report', label],
      ['Read at', moment(board.weather.readAt)],
    ]);
  }
  board.weather.state = 'failed';
  // Provider-owned strings that resemble another subsystem's code remain literal.
  board.weather.failure = 'collectionFailed';
  await publish();
  expect(view.root.findAllByType(TextRow).map((node) => property(node, 'text'))).toContain(
    'collectionFailed',
  );
  board.weather.failure = 'providerNotConfigured';
  await publish();
  expect(JSON.stringify(view.toJSON())).toContain('Weather is not configured in this host.');
  busy = true;
  await publish();
  expect(property(button(), 'disabled')).toBe(true);
  busy = false;
  sessionId = null;
  await publish();
  expect(property(button(), 'disabled')).toBe(true);
  sessionId = 'weather-session';
  await publish();
  await act(async () => {
    invoke(button(), 'onPress');
  });
  expect(perform.mock.calls).toEqual([[{ action: 'weather', consent: true }]]);
  board.weather.state = 'available';
  board.weather.failure = null;
  board.weather.temperatureC = 10;
  await publish();
  expect(value('Report')).toBe('Report available');
  expect(value('Temperature')).toBe('50 °F');
  expect(JSON.stringify(view.toJSON())).not.toContain('Weather is not configured in this host.');
  await act(async () => {
    view.unmount();
  });
});
