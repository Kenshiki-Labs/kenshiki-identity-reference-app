import { sensorBoardFixture } from '../testing/SensorBoardFixtures';
import { copy, measure, pageDoc, pages, permissioned, plain } from './SensorPresentation';

test('ported catalog supplies twelve documented pages and all thirteen permission groupings', () => {
  expect(pages).toHaveLength(13);
  expect(pages.filter(permissioned)).toEqual(['barometer', 'bluetooth', 'location', 'weather']);
  for (const page of pages) {
    if (page === 'weather') expect(pageDoc(page)).toBeUndefined();
    else expect(pageDoc(page)).toBeDefined();
    expect(copy(`meaning.${page}`)).not.toBe(`meaning.${page}`);
  }
});
test('unit choices change presentation without mutating native evidence', () => {
  const board = sensorBoardFixture();
  board.units = 'metric';
  expect(measure(100, 'pressure', board)).toBe('1,000 hPa');
  board.units = 'imperial';
  expect(measure(0, 'temperature', board)).toBe('32 °F');
  expect(measure(null, 'distance', board)).toBe('—');
  expect(measure(1, 'distance', board)).toBe('3.281 ft');
  board.units = 'system';
  board.systemUsesImperial = true;
  expect(measure(0, 'temperature', board)).toBe('32 °F');
  expect(board.location.fix).toBeNull();
});
test('OS permission and SDK state are rendered in plain words', () => {
  expect(plain('given')).toBe('Allowed');
  expect(plain('notRequested')).toBe('Not asked yet');
  expect(plain('poweredOff')).toBe('Off');
  expect(plain(false)).toBe('No');
});
