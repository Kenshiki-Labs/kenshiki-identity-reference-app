import { AppState } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { airComparison, continuityResult } from './__tests__/FusionFixtures';
import { sensorBoardFixture } from './__tests__/SensorBoardFixtures';
import { actionSheets, invoke, required } from './__tests__/support';
import { AirCheckScreen } from './AirCheckScreen';
import { ContinuityScreen } from './ContinuityScreen';
import { GlossaryScreen, OverTimeScreen, ThreeProofsScreen } from './FusionExplanations';
import { FusionScreen } from './FusionScreen';
import { ButtonRow, ListRow, ValueRow } from './ui/List';

let mockBoard = sensorBoardFixture();
let mockBusy = false;
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual<typeof import('@react-navigation/native')>('@react-navigation/native'),
  useIsFocused: () => mockFocused,
}));
const mockPerform = jest.fn();
jest.mock('./SensorScreen', () => ({
  useSensorSession: () => ({
    state: { board: mockBoard, busy: mockBusy, failure: null, sessionId: 'sensor-session' },
    failure: null,
    perform: mockPerform,
  }),
}));
jest.mock('@kenshiki/identity-capture', () => ({
  documentFieldReadout: jest.requireActual<
    typeof import('../../ReactNative/identity-capture/src/DocumentReadout')
  >('../../ReactNative/identity-capture/src/DocumentReadout').documentFieldReadout,
  IdentitySymbol: 'MockSymbol',
}));
async function render(element: React.ReactElement) {
  let view: ReactTestRenderer | undefined;
  await act(async () => {
    view = create(element);
  });
  return required(view);
}
function words(view: ReactTestRenderer) {
  return JSON.stringify(view.toJSON());
}
beforeEach(() => {
  mockBoard = sensorBoardFixture();
  mockBusy = false;
  mockFocused = true;
  AppState.currentState = 'active';
  jest.clearAllMocks();
});

test('Fusion summary uses live results and opens the companion details', async () => {
  mockBoard.fusion.airCheck = {
    state: 'compared',
    ranAt: '2026-10-09T12:00:00Z',
    comparison: airComparison(),
  };
  mockBoard.fusion.continuity = { state: 'evaluated', result: continuityResult() };
  const open = jest.fn();
  const view = await render(<FusionScreen onOpen={open} />);
  expect(words(view)).toContain("Doesn't match the area");
  expect(words(view)).toContain('Nothing to compare with yet');
  const row = required(view.root.findAllByType(ListRow).find((node) => node.props.label === 'Air check'));
  await act(async () => {
    invoke(row, 'onPress');
  });
  expect(open).toHaveBeenCalledWith('AirCheck');
  await act(async () => view.unmount());
});
test('Air Check starts on entry once, locks while busy, and retains exact native math values', async () => {
  const view = await render(<AirCheckScreen />);
  expect(mockPerform).toHaveBeenCalledTimes(1);
  expect(mockPerform).toHaveBeenCalledWith({ action: 'airCheck', consent: true });
  mockBusy = true;
  await act(async () => view.update(<AirCheckScreen />));
  expect(view.root.findByType(ButtonRow).props.disabled).toBe(true);
  mockBusy = false;
  mockBoard.fusion.airCheck = {
    state: 'compared',
    ranAt: '2026-10-09T12:00:00Z',
    comparison: airComparison(),
  };
  await act(async () => view.update(<AirCheckScreen />));
  expect(mockPerform).toHaveBeenCalledTimes(1);
  expect(view.root.findByType(ButtonRow).props.label).toBe('Refresh air check');
  expect(words(view)).toContain('2 kPa');
  expect(words(view)).toContain('Not available');
  await act(async () => {
    invoke(view.root.findByType(ListRow), 'onPress');
  });
  expect(words(view)).toContain('8,123.456 m');
  // A later board refresh must not mix new math into the already-open result snapshot.
  mockBoard.fusion.airCheck = {
    state: 'compared',
    ranAt: '2026-10-09T12:01:00Z',
    comparison: { ...airComparison(), math: [{ name: 'scaleHeight', value: 9000, unit: 'm' }] },
  };
  await act(async () => view.update(<AirCheckScreen />));
  expect(words(view)).toContain('8,123.456 m');
  mockBoard.fusion.airCheck = { state: 'idle' };
  await act(async () => view.update(<AirCheckScreen />));
  expect(view.root.findAllByProps({ testID: 'fusion-math' })).toHaveLength(0);
  expect(mockPerform).toHaveBeenCalledTimes(1);
  mockFocused = false;
  await act(async () => view.update(<AirCheckScreen />));
  mockFocused = true;
  mockBusy = true;
  await act(async () => view.update(<AirCheckScreen />));
  expect(mockPerform).toHaveBeenCalledTimes(1);
  mockBusy = false;
  await act(async () => view.update(<AirCheckScreen />));
  expect(mockPerform).toHaveBeenCalledTimes(2);
  expect(view.root.findByType(ButtonRow).props.label).toBe('Retry air check');
  await act(async () => {
    invoke(view.root.findByType(ButtonRow), 'onPress');
  });
  expect(mockPerform).toHaveBeenCalledTimes(3);
  await act(async () => view.unmount());
});
test.each(['noFix', 'unavailable', 'weatherFailure'] as const)(
  'Air Check %s cannot render a comparison',
  async (state) => {
    const ranAt = '2026-10-09T12:00:00Z';
    mockBoard.fusion.airCheck =
      state === 'noFix'
        ? { state, ranAt }
        : state === 'unavailable'
          ? { state, ranAt, reason: 'cancelled' }
          : {
              state,
              ranAt,
              reason: 'weatherProviderFailure',
              stage: 'observation',
              stationID: null,
              observedAt: null,
              receivedAt: ranAt,
              httpStatus: 503,
              failingField: null,
              decodingPath: null,
            };
    const view = await render(<AirCheckScreen />);
    expect(view.root.findAllByType(ListRow)).toHaveLength(0);
    expect(words(view)).not.toContain('Matches the area');
    if (state === 'unavailable') expect(words(view)).toContain('cancelled');
    await act(async () => view.unmount());
  },
);
test('Continuity keeps breadth distinct from coverage and asks before forgetting', async () => {
  mockBoard.fusion.continuity = { state: 'evaluated', result: continuityResult() };
  const sheets = actionSheets();
  const view = await render(<ContinuityScreen onOverTime={() => {}} />);
  const values = view.root.findAllByType(ValueRow);
  expect(values.find((row) => row.props.label === 'Breadth')?.props.value).toBe('40%');
  expect(values.find((row) => row.props.label === 'Coverage')?.props.value).toBe('50%');
  expect(words(view)).toContain('Does not check out');
  expect(words(view)).toContain('permissionDenied');
  const forget = required(view.root.findAllByType(ButtonRow).find((row) => row.props.destructive));
  await act(async () => {
    invoke(forget, 'onPress');
  });
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => sheets.last().choose(1));
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => {
    invoke(forget, 'onPress');
  });
  await act(async () => sheets.last().choose(0));
  expect(mockPerform).toHaveBeenCalledWith({ action: 'forgetContinuity', consent: true });
  await act(async () => view.unmount());
});
test('Over Time never manufactures a timeline from absent quality', async () => {
  const view = await render(<OverTimeScreen />);
  expect(words(view)).toContain('Missing inputs are not replaced');
  mockBoard.fusion.continuity = { state: 'evaluated', result: continuityResult() };
  await act(async () => view.update(<OverTimeScreen />));
  expect(words(view)).toContain('43%');
  expect(words(view)).toContain('Illustrative projections, not recorded history');
  await act(async () => view.unmount());
});
test('explanation pages retain verification limits and locale sorted definitions', async () => {
  const proofs = await render(<ThreeProofsScreen />);
  expect(words(proofs)).toContain('does not independently prove device identity');
  expect(words(proofs)).not.toContain('waiting to be brought across');
  const glossary = await render(<GlossaryScreen />);
  const rendered = words(glossary);
  expect(rendered.indexOf('App Attest')).toBeLessThan(rendered.indexOf('Canonical form'));
  await act(async () => {
    proofs.unmount();
    glossary.unmount();
  });
});
