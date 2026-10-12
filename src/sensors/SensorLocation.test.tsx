import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { sensorBoardFixture } from '../testing/SensorBoardFixtures';
import { invoke, property, required } from '../testing/support';
import { locationRows } from './SensorBoardLocation';
import { moment } from './SensorPresentation';
import { ButtonRow, ValueRow } from '../ui/List';

jest.mock('@kenshiki/identity-capture', () => ({ IdentitySensorMap: 'SensorMap' }));

test('location keeps freshness, delivery and trail evidence distinct through clear, failure and recovery', async () => {
  const board = sensorBoardFixture();
  board.units = 'metric';
  board.permissions.location = 'refused';
  const fix = {
    id: 'cached',
    latitude: 37.123456789,
    longitude: -122.123456789,
    horizontalAccuracy: 0,
    verticalAccuracy: 0,
    altitude: null,
    speed: 0,
    course: 0,
    measuredAt: '2026-10-11T12:00:00Z',
    simulated: false,
    accessory: null,
    precise: true,
    unmetTerms: [],
  };
  board.location = {
    ...board.location,
    fix,
    trail: [fix],
    answeredAt: '2026-10-11T12:05:00Z',
    deliveredCount: 1,
    permissionAtDelivery: 'given',
    precisionAtDelivery: 'full',
  };
  const perform = jest.fn();
  let busy = false;
  let sessionId: string | null = 'location-session';
  let now = Date.parse('2026-10-11T12:05:00Z');
  let view!: ReactTestRenderer;
  const content = () => <>{locationRows({ board, busy, perform, sessionId, now })}</>;
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
  const button = (label: string) =>
    required(view.root.findAllByType(ButtonRow).find((node) => property(node, 'label') === label));
  expect(perform).not.toHaveBeenCalled();
  expect(rows().slice(0, 5)).toEqual([
    ['Permission', 'Denied'],
    ['Answered at', moment(board.location.answeredAt)],
    ['Positions received', '1'],
    ['Measured at', moment(fix.measuredAt)],
    ['Age', '300 s'],
  ]);
  expect(value('Position accuracy')).toBe('0 m');
  expect(value('Speed')).toBe('0 m/s');
  expect(value('Direction')).toBe('0 °');
  expect(value('Height accuracy')).toBe('Not valid');
  expect(value('Height above sea level')).toBe('—');
  expect(value('Made up by software')).toBe('No');
  expect(value('From an accessory')).toBe('—');
  expect(value('Basic checks')).toBe('Passed');
  expect(value('Permission at the time')).toBe('Allowed');
  expect(value('Precision at the time')).toBe('Precise');
  expect(view.root.findByProps({ sessionId: 'location-session' })).toBeDefined();
  now += 1000;
  await publish();
  expect(value('Age')).toBe('301 s');
  fix.measuredAt = '2026-10-11T12:10:00Z';
  fix.verticalAccuracy = -1;
  await publish();
  expect(value('Age')).toBe('In the future');
  expect(value('Height accuracy')).toBe('Not valid');
  // Busy controls cannot be activated through the shared native pressable.
  busy = true;
  await publish();
  expect(property(button('Get one fix'), 'disabled')).toBe(true);
  expect(property(button('Clear map trail'), 'disabled')).toBe(true);
  busy = false;
  await publish();
  await act(async () => {
    invoke(button('Clear map trail'), 'onPress');
  });
  expect(perform.mock.calls).toEqual([[{ action: 'clearTrail', consent: true }]]);
  board.location.trail = [];
  await publish();
  expect(value('Latitude')).toBe('37.123456789');
  expect(value('Positions on the map')).toBe('0 of 20');
  expect(property(button('Clear map trail'), 'disabled')).toBe(true);
  board.location.trail = [fix];
  board.location.fix = null;
  board.location.failure = 'locationUnavailable';
  board.location.deliveredCount = 0;
  await publish();
  expect(value('Result')).toBe('No position');
  expect(value('Positions received')).toBe('0');
  expect(value('Positions on the map')).toBe('1 of 20');
  expect(rows().some((row) => row[0] === 'Latitude' || row[0] === 'Permission at the time')).toBe(false);
  const rendered = JSON.stringify(view.toJSON());
  expect(rendered.indexOf('Location is unavailable.')).toBeGreaterThan(-1);
  expect(rendered.indexOf('Location is unavailable.')).toBeLessThan(rendered.indexOf('SensorMap'));
  board.location.fix = {
    ...fix,
    verticalAccuracy: 2,
    altitude: 0,
    simulated: null,
    accessory: false,
    unmetTerms: ['finiteTimestamp'],
  };
  board.location.failure = null;
  board.location.precisionAtDelivery = 'reduced';
  await publish();
  expect(value('Height accuracy')).toBe('2 m');
  expect(value('Height above sea level')).toBe('0 m');
  expect(value('Made up by software')).toBe('—');
  expect(value('From an accessory')).toBe('No');
  expect(value('Basic checks')).toBe('Failed');
  expect(value('Precision at the time')).toBe('Approximate');
  expect(JSON.stringify(view.toJSON())).toContain('No real time');
  sessionId = null;
  await publish();
  expect(property(button('Get one fix'), 'disabled')).toBe(true);
  expect(property(button('Clear map trail'), 'disabled')).toBe(true);
  await act(async () => {
    view.unmount();
  });
});
