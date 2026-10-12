import type {
  FusionAirCheck,
  FusionContinuity,
  SensorBoardState,
  SensorSnapshot,
} from '@kenshiki/identity-capture';
import { AppState, type AppStateStatus, ScrollView, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { airComparison, continuityResult } from '../testing/FusionFixtures';
import { sensorBoardFixture } from '../testing/SensorBoardFixtures';
import { actionSheets, invoke, property, required } from '../testing/support';
import { AirCheckScreen } from './AirCheckScreen';
import { ContinuityScreen } from './ContinuityScreen';
import { GlossaryScreen, OverTimeScreen, ThreeProofsScreen } from './FusionExplanations';
import { FusionScreen } from './FusionScreen';
import { Action } from '../ui/Action';
import { ButtonRow, ListRow, ListSection, TextRow, TitleRow, ValueRow } from '../ui/List';
import { Page, PageHeaderContext } from '../ui/Page';
import { PageLead } from '../ui/PageLead';

let mockBoard: SensorBoardState | null = sensorBoardFixture();
let mockFailure: string | null = null;
let mockStateFailure: string | null = null;
let mockBusy = false;
let mockFocused = true;
let mockSessionId: string | null = 'sensor-session';
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual<typeof import('@react-navigation/native')>('@react-navigation/native'),
  useIsFocused: () => mockFocused,
}));
const mockPerform = jest.fn();
jest.mock('../sensors/SensorScreen', () => ({
  useSensorSession: () => ({
    state: { board: mockBoard, busy: mockBusy, failure: mockStateFailure, sessionId: mockSessionId },
    failure: mockFailure,
    perform: mockPerform,
  }),
}));
jest.mock('@kenshiki/identity-capture', () => ({
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
  mockFailure = null;
  mockStateFailure = null;
  mockFocused = true;
  mockSessionId = 'sensor-session';
  AppState.currentState = 'active';
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

test('Fusion summary uses live results and opens the companion details', async () => {
  required(mockBoard).fusion.airCheck = {
    state: 'compared',
    ranAt: '2026-10-09T12:00:00Z',
    comparison: airComparison(),
  };
  required(mockBoard).fusion.continuity = { state: 'evaluated', result: continuityResult() };
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
function landingSummaries(view: ReactTestRenderer) {
  return view.root
    .findAllByType(ListRow)
    .slice(0, 2)
    .map((row) => property(row, 'status'));
}
function summaries(view: ReactTestRenderer) {
  return view.root.findAllByType(ValueRow).map((row) => property(row, 'value'));
}

test.each(['session', 'board'] as const)(
  'Fusion distinguishes pending acquisition, %s failure, and recovered idle',
  async (source) => {
    mockBoard = null;
    const view = await render(<FusionScreen onOpen={jest.fn()} />);
    expect(landingSummaries(view)).toEqual(['Opening sensors…', 'Opening sensors…']);
    if (source === 'session') mockFailure = 'Session could not open';
    else mockStateFailure = 'Board could not open';
    await act(async () => view.update(<FusionScreen onOpen={jest.fn()} />));
    expect(landingSummaries(view)).toEqual(['Not available', 'Not available']);
    expect(words(view)).toContain(source === 'session' ? 'Session could not open' : 'Board could not open');
    mockFailure = null;
    mockStateFailure = null;
    mockBoard = sensorBoardFixture();
    await act(async () => view.update(<FusionScreen onOpen={jest.fn()} />));
    expect(landingSummaries(view)).toEqual(['Not run yet', 'Not run yet']);
    expect(words(view)).not.toContain('could not open');
    expect(mockPerform).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  },
);

test('Fusion retains available SDK results beside a later request failure', async () => {
  required(mockBoard).fusion.airCheck = {
    state: 'compared',
    ranAt: '2026-10-09T12:00:00Z',
    comparison: airComparison(),
  };
  required(mockBoard).fusion.continuity = { state: 'evaluated', result: continuityResult() };
  mockStateFailure = 'Latest refresh failed';
  const view = await render(<FusionScreen onOpen={jest.fn()} />);
  expect(landingSummaries(view)).toEqual(["Doesn't match the area", 'Nothing to compare with yet']);
  expect(words(view)).toContain('Latest refresh failed');
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

const airCases: [FusionAirCheck, string][] = [
  [{ state: 'idle' }, 'Not run yet'],
  [{ state: 'running' }, 'Checking…'],
  [{ state: 'noFix', ranAt: '2026-10-09T12:00:00Z' }, 'Not available'],
  [{ state: 'unavailable', ranAt: '2026-10-09T12:00:00Z', reason: 'cancelled' }, 'Not available'],
  [
    {
      state: 'compared',
      ranAt: '2026-10-09T12:00:00Z',
      comparison: { ...airComparison(), verdict: 'consistent' },
    },
    'Matches the area',
  ],
];
test.each(airCases)('Fusion maps air state %j to its SDK summary', async (air, expected) => {
  required(mockBoard).fusion.airCheck = air;
  const view = await render(<FusionScreen onOpen={jest.fn()} />);
  expect(landingSummaries(view)[0]).toBe(expected);
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});
const continuityCases: [FusionContinuity, string][] = [
  [{ state: 'unavailable', reason: 'noEnvelope' }, 'Not available'],
  [{ state: 'storageFailure', reason: 'saveFailed' }, 'Not available'],
  [{ state: 'evaluated', result: { ...continuityResult(), verdict: 'held' } }, 'Same phone as before'],
  [{ state: 'evaluated', result: { ...continuityResult(), verdict: 'broke' } }, 'Something changed'],
];
test.each(continuityCases)(
  'Fusion maps continuity state %j to its SDK summary',
  async (continuity, expected) => {
    required(mockBoard).fusion.continuity = continuity;
    const view = await render(<FusionScreen onOpen={jest.fn()} />);
    expect(landingSummaries(view)[1]).toBe(expected);
    expect(mockPerform).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  },
);

test('Fusion opens each existing landing destination without issuing SDK commands', async () => {
  const open = jest.fn();
  const view = await render(<FusionScreen onOpen={open} />);
  const rows = view.root.findAllByType(ListRow);
  expect(rows).toHaveLength(4);
  for (const row of rows)
    await act(async () => {
      await invoke(row, 'onPress');
    });
  expect(open.mock.calls).toEqual([['AirCheck'], ['Continuity'], ['ThreeProofs'], ['Glossary']]);
  expect(mockPerform).not.toHaveBeenCalled();
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
  required(mockBoard).fusion.airCheck = {
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
  required(mockBoard).fusion.airCheck = {
    state: 'compared',
    ranAt: '2026-10-09T12:01:00Z',
    comparison: { ...airComparison(), math: [{ name: 'scaleHeight', value: 9000, unit: 'm' }] },
  };
  await act(async () => view.update(<AirCheckScreen />));
  expect(words(view)).toContain('8,123.456 m');
  required(mockBoard).fusion.airCheck = { state: 'idle' };
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
test('Air Check waits for its board and session without claiming unknown motion permission', async () => {
  mockBoard = null;
  mockSessionId = null;
  const view = await render(<AirCheckScreen />);
  expect(property(view.root.findByType(ButtonRow), 'disabled')).toBe(true);
  expect(words(view)).not.toContain('Needs Motion & Fitness');
  expect(property(view.root.findByType(ButtonRow), 'label')).toBe('Opening sensors…');
  expect(mockPerform).not.toHaveBeenCalled();
  mockBoard = sensorBoardFixture();
  await act(async () => view.update(<AirCheckScreen />));
  expect(words(view)).toContain('Needs Motion & Fitness');
  expect(property(view.root.findByType(ButtonRow), 'disabled')).toBe(true);
  expect(mockPerform).not.toHaveBeenCalled();
  mockSessionId = 'acquired-session';
  mockBoard.permissions.motion = 'given';
  await act(async () => view.update(<AirCheckScreen />));
  expect(words(view)).not.toContain('Needs Motion & Fitness');
  expect(mockPerform).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});

test('Air Check waits for foreground, runs once, and removes activity listeners on blur and unmount', async () => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const removals: jest.Mock[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    const remove = jest.fn(() => {
      listeners.delete(listener);
    });
    removals.push(remove);
    return { remove };
  });
  const change = async (next: AppStateStatus) => {
    await act(async () => {
      AppState.currentState = next;
      for (const listener of listeners) listener(next);
    });
  };
  AppState.currentState = 'background';
  const view = await render(<AirCheckScreen />);
  expect(mockPerform).not.toHaveBeenCalled();
  await change('active');
  expect(mockPerform).toHaveBeenCalledTimes(1);
  await change('background');
  await change('active');
  expect(mockPerform).toHaveBeenCalledTimes(1);
  mockFocused = false;
  await act(async () => view.update(<AirCheckScreen />));
  expect(listeners.size).toBe(0);
  await change('background');
  mockFocused = true;
  await act(async () => view.update(<AirCheckScreen />));
  expect(mockPerform).toHaveBeenCalledTimes(1);
  mockFocused = false;
  await act(async () => view.update(<AirCheckScreen />));
  await change('active');
  expect(mockPerform).toHaveBeenCalledTimes(1);
  mockFocused = true;
  await act(async () => view.update(<AirCheckScreen />));
  expect(mockPerform).toHaveBeenCalledTimes(2);
  await act(async () => view.unmount());
  expect(listeners.size).toBe(0);
  for (const remove of removals) expect(remove).toHaveBeenCalledTimes(1);
});

test('Air Check joins an already-running visit and starts only for a replacement session', async () => {
  required(mockBoard).fusion.airCheck = { state: 'running' };
  const view = await render(<AirCheckScreen />);
  expect(mockPerform).not.toHaveBeenCalled();
  expect(property(view.root.findByType(ButtonRow), 'disabled')).toBe(true);
  required(mockBoard).fusion.airCheck = {
    state: 'compared',
    ranAt: '2026-10-09T12:00:00Z',
    comparison: airComparison(),
  };
  await act(async () => view.update(<AirCheckScreen />));
  expect(mockPerform).not.toHaveBeenCalled();
  mockSessionId = 'replacement-session';
  mockBoard = sensorBoardFixture();
  await act(async () => view.update(<AirCheckScreen />));
  expect(mockPerform).toHaveBeenCalledTimes(1);
  mockBoard = { ...mockBoard };
  await act(async () => view.update(<AirCheckScreen />));
  expect(mockPerform).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});

test('Air Check math uses one shared Done and reopens the latest SDK snapshot', async () => {
  required(mockBoard).fusion.airCheck = {
    state: 'compared',
    ranAt: '2026-10-09T12:00:00Z',
    comparison: airComparison(),
  };
  const view = await render(<AirCheckScreen />);
  const measured = view.root.findAllByType(ValueRow);
  for (const [label, value] of [
    ['Measured here', '100 kPa'],
    ['Expected here', '98 kPa'],
    ['Difference', '2 kPa'],
    ['Allowed', '0.2 kPa'],
  ]) {
    expect(property(required(measured.find((row) => property(row, 'label') === label)), 'value')).toBe(value);
  }

  await act(async () => {
    await invoke(view.root.findByType(ListRow), 'onPress');
  });
  const done = view.root.findAllByType(Action).filter((node) => property(node, 'label') === 'Done');
  expect(done).toHaveLength(1);
  expect(
    view.root.findAllByType(ButtonRow).filter((node) => property(node, 'label') === 'Done'),
  ).toHaveLength(0);
  required(mockBoard).fusion.airCheck = {
    state: 'compared',
    ranAt: '2026-10-09T12:01:00Z',
    comparison: { ...airComparison(), math: [{ name: 'scaleHeight', value: 9000, unit: 'm' }] },
  };
  await act(async () => view.update(<AirCheckScreen />));
  expect(words(view)).toContain('8,123.456 m');
  await act(async () => {
    await invoke(required(done[0]), 'onPress');
  });
  expect(view.root.findAllByProps({ testID: 'fusion-math' })).toHaveLength(0);
  await act(async () => {
    await invoke(view.root.findByType(ListRow), 'onPress');
  });
  expect(words(view)).toContain('9,000 m');
  expect(words(view)).not.toContain('8,123.456 m');
  await act(async () => view.unmount());
});
test.each(['noFix', 'unavailable', 'weatherFailure'] as const)(
  'Air Check %s cannot render a comparison',
  async (state) => {
    const ranAt = '2026-10-09T12:00:00Z';
    required(mockBoard).fusion.airCheck =
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
function continuityReading(): SensorSnapshot {
  const support = { status: 'not_collected' } as const;
  return {
    startedAt: '2026-10-11T12:00:00Z',
    endedAt: '2026-10-11T12:00:01Z',
    durationMilliseconds: 1000,
    battery: { support },
    motion: { support, sampleCount: 0 },
    magnetometer: { support, sampleCount: 0 },
    barometer: { support },
    bluetooth: { support },
    connectivity: { support, interfaceTypes: [], availableInterfaceTypes: [], perInterfacePathStatuses: {} },
    deviceSurface: { support, platform: 'ios', systemName: 'iOS', simulator: true },
    telephony: { support, radioGenerations: [] },
  };
}

test.each(['session', 'board'] as const)(
  'Continuity distinguishes acquisition, %s failure and ready reading',
  async (source) => {
    mockBoard = null;
    const view = await render(<ContinuityScreen onOverTime={jest.fn()} />);
    expect(words(view)).toContain('Opening sensors…');
    expect(words(view)).not.toContain('This reading carries no receipt');
    for (const row of view.root.findAllByType(ButtonRow)) expect(property(row, 'disabled')).toBe(true);
    if (source === 'session') mockFailure = 'Session unavailable';
    else mockStateFailure = 'Board unavailable';
    await act(async () => view.update(<ContinuityScreen onOverTime={jest.fn()} />));
    expect(words(view)).toContain('Not available');
    expect(words(view)).not.toContain('Opening sensors…');
    expect(words(view)).toContain(source === 'session' ? 'Session unavailable' : 'Board unavailable');
    mockFailure = null;
    mockStateFailure = null;
    mockBoard = sensorBoardFixture();
    await act(async () => view.update(<ContinuityScreen onOverTime={jest.fn()} />));
    expect(words(view)).toContain('Waiting for a reading from the Sensors tab.');
    expect(words(view)).not.toContain('This reading carries no receipt');
    mockBoard.reading = continuityReading();
    await act(async () => view.update(<ContinuityScreen onOverTime={jest.fn()} />));
    expect(words(view)).toContain('A reading is ready to judge');
    expect(words(view)).not.toContain('Waiting for a reading from the Sensors tab.');
    expect(words(view)).toContain('This reading carries no receipt');
    const evaluate = required(
      view.root.findAllByType(ButtonRow).find((row) => !property(row, 'destructive')),
    );
    expect(property(evaluate, 'disabled')).toBe(false);
    expect(mockPerform).not.toHaveBeenCalled();
    await act(async () => {
      await invoke(evaluate, 'onPress');
    });
    expect(mockPerform).toHaveBeenCalledWith({ action: 'continuity', consent: true });
    mockBusy = true;
    await act(async () => view.update(<ContinuityScreen onOverTime={jest.fn()} />));
    for (const row of view.root.findAllByType(ButtonRow)) expect(property(row, 'disabled')).toBe(true);
    await act(async () => view.unmount());
  },
);

test('Continuity retains evaluated receipt provenance and results beside refresh failure', async () => {
  const result = continuityResult();
  result.receipt = { ...result.receipt, publicKeyHash: 'evaluated-receipt-key' };
  required(mockBoard).fusion.continuity = { state: 'evaluated', result };
  required(mockBoard).fusion.receipt = { ...result.receipt, publicKeyHash: 'latest-board-receipt-key' };
  mockStateFailure = 'Latest refresh failed';
  const open = jest.fn();
  const view = await render(<ContinuityScreen onOverTime={open} />);
  expect(words(view)).toContain('Latest refresh failed');
  expect(words(view)).toContain('Nothing to compare with yet');
  expect(words(view)).toContain('evaluated-receipt-key');
  expect(words(view)).not.toContain('latest-board-receipt-key');
  // The destination callback is supplied by the native stack; opening it does not evaluate.
  const destination = required(
    view.root.findAllByType(ListRow).find((row) => property(row, 'label') === 'How this behaves over time'),
  );
  await act(async () => {
    await invoke(destination, 'onPress');
  });
  expect(open).toHaveBeenCalledTimes(1);
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test.each<{ continuity: FusionContinuity; message: string }>([
  {
    continuity: { state: 'unavailable', reason: 'invalidReceipt' },
    message: 'The reading’s receipt did not verify. It cannot establish continuity.',
  },
  {
    continuity: { state: 'storageFailure', reason: 'eraseFailed' },
    message: 'Continuity history could not be removed.',
  },
])('Continuity preserves explicit failure: $message', async ({ continuity, message }) => {
  required(mockBoard).reading = continuityReading();
  required(mockBoard).fusion.continuity = continuity;
  const view = await render(<ContinuityScreen onOverTime={jest.fn()} />);
  expect(words(view)).toContain(message);
  expect(words(view)).not.toContain('A reading is ready to judge');
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Continuity keeps breadth distinct from coverage and asks before forgetting', async () => {
  required(mockBoard).fusion.continuity = { state: 'evaluated', result: continuityResult() };
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
  required(mockBoard).fusion.continuity = { state: 'evaluated', result: continuityResult() };
  await act(async () => view.update(<OverTimeScreen />));
  expect(words(view)).toContain('43%');
  expect(words(view)).toContain('Illustrative projections, not recorded history');
  await act(async () => view.unmount());
});
test.each(['session', 'board'] as const)(
  'Over Time distinguishes acquisition and %s failure from absent evaluation',
  async (source) => {
    mockBoard = null;
    const view = await render(<OverTimeScreen />);
    expect(words(view)).toContain('Opening sensors…');
    expect(words(view)).not.toContain('A continuity evaluation is required.');
    if (source === 'session') mockFailure = 'Session unavailable';
    else mockStateFailure = 'Board unavailable';
    await act(async () => view.update(<OverTimeScreen />));
    expect(words(view)).toContain('Not available');
    expect(words(view)).not.toContain('Opening sensors…');
    expect(words(view)).toContain(source === 'session' ? 'Session unavailable' : 'Board unavailable');
    mockFailure = null;
    mockStateFailure = null;
    mockBoard = sensorBoardFixture();
    await act(async () => view.update(<OverTimeScreen />));
    expect(words(view)).toContain('A continuity evaluation is required.');
    expect(words(view)).toContain('Illustrative projections, not recorded history');
    expect(view.root.findAllByType(TitleRow)).toHaveLength(0);
    expect(mockPerform).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  },
);

test('Over Time retains its disclaimer when scenarios are empty and preserves independent gaps', async () => {
  required(mockBoard).fusion.continuity = {
    state: 'evaluated',
    result: { ...continuityResult(), scenarios: [] },
  };
  const view = await render(<OverTimeScreen />);
  expect(words(view)).toContain('How continuity changes over time');
  expect(words(view)).toContain('Illustrative projections, not recorded history');
  expect(words(view)).toContain('Not available');
  expect(words(view)).not.toContain('A continuity evaluation is required.');
  expect(view.root.findAllByType(TitleRow)).toHaveLength(0);
  const gap = view.root.findByType(ValueRow);
  expect(property(gap, 'label')).toBe('48 hours');
  expect(property(gap, 'value')).toBe('50%');
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Over Time preserves exact SDK projections including zero beside refresh failure and empty gaps', async () => {
  required(mockBoard).fusion.continuity = {
    state: 'evaluated',
    result: {
      ...continuityResult(),
      scenarios: [
        { days: 0, readings: 0, mean: 0, lowerBound: 0, confidence: 0 },
        { days: 7, readings: 14, mean: 0.4312, lowerBound: 0.2034, confidence: 0.4656 },
      ],
      gaps: [],
    },
  };
  mockStateFailure = 'Refresh unavailable';
  const view = await render(<OverTimeScreen />);
  expect(words(view)).toContain('Refresh unavailable');
  expect(
    view.root.findAllByType(TitleRow).map((row) => [property(row, 'title'), property(row, 'detail')]),
  ).toEqual([
    ['0 days · 0 readings: 0%', 'At least 0%; confidence 0%'],
    ['7 days · 14 readings: 43.12%', 'At least 20.34%; confidence 46.56%'],
  ]);
  expect(view.root.findAllByType(ValueRow)).toHaveLength(0);
  expect(words(view)).toContain('What a gap costs');
  expect(words(view)).toContain('No gap projection is available for this evaluation.');
  expect(words(view)).toContain('Illustrative projections, not recorded history');
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test.each<{ continuity: FusionContinuity; message: string }>([
  {
    continuity: { state: 'unavailable', reason: 'invalidReceipt' },
    message: 'The reading’s receipt did not verify. It cannot establish continuity.',
  },
  {
    continuity: { state: 'storageFailure', reason: 'readFailed' },
    message: 'Continuity history could not be read.',
  },
])(
  'Over Time replaces stale projections with explicit failure: $message',
  async ({ continuity, message }) => {
    required(mockBoard).fusion.continuity = { state: 'evaluated', result: continuityResult() };
    const view = await render(<OverTimeScreen />);
    expect(view.root.findAllByType(TitleRow)).toHaveLength(1);
    required(mockBoard).fusion.continuity = continuity;
    await act(async () => view.update(<OverTimeScreen />));
    expect(words(view)).toContain(message);
    expect(view.root.findAllByType(TitleRow)).toHaveLength(0);
    expect(view.root.findAllByType(ValueRow)).toHaveLength(0);
    expect(words(view)).not.toContain('A continuity evaluation is required.');
    expect(words(view)).toContain('Illustrative projections, not recorded history');
    expect(mockPerform).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  },
);

test('explanation pages retain verification limits and locale sorted definitions', async () => {
  const proofs = await render(<ThreeProofsScreen />);
  expect(words(proofs)).toContain('does not independently prove device identity');
  expect(words(proofs)).not.toContain('waiting to be brought across');
  expect(words(proofs)).not.toContain('button beside the export');
  const glossary = await render(<GlossaryScreen />);
  const rendered = words(glossary);
  expect(rendered.indexOf('App Attest')).toBeLessThan(rendered.indexOf('Canonical form'));
  await act(async () => {
    proofs.unmount();
    glossary.unmount();
  });
});

test('Fusion distinguishes a ready reading from an unevaluated empty board without starting work', async () => {
  required(mockBoard).reading = continuityReading();
  const view = await render(<FusionScreen onOpen={jest.fn()} />);
  expect(landingSummaries(view)).toEqual(['Not run yet', 'A reading is ready to judge']);
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Continuity exposes an unknown break reason and never turns missing breadth into zero', async () => {
  required(mockBoard).fusion.continuity = {
    state: 'evaluated',
    result: {
      ...continuityResult(),
      breakReason: 'future-break-reason',
      math: [{ name: 'coverage', value: 0, unit: '' }],
      receipt: {
        ...continuityResult().receipt,
        secureHardware: true,
        locallyVerified: true,
        previousRoot: 'previous-root',
      },
    },
  };
  const view = await render(<ContinuityScreen onOverTime={jest.fn()} />);
  const values = view.root.findAllByType(ValueRow);
  expect(values.find((row) => property(row, 'label') === 'Breadth')?.props.value).toBe('Not available');
  expect(values.find((row) => property(row, 'label') === 'Coverage')?.props.value).toBe('0%');
  expect(words(view)).toContain('future-break-reason');
  expect(words(view)).toContain('Secure Enclave');
  expect(words(view)).toContain('previous-root');
  expect(words(view)).not.toContain('Does not check out');
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Air Check retains absent station metadata and zero measurements in its displayed evidence', async () => {
  required(mockBoard).fusion.airCheck = {
    state: 'compared',
    ranAt: '2026-10-11T12:00:00Z',
    comparison: {
      ...airComparison(),
      stationID: null,
      stationName: null,
      pressureQuality: null,
      pressureField: null,
      temperatureQuality: 'temperature-quality',
      observationURL: 'https://example.test/observation',
      temperatureC: 0,
      humidityPercent: 0,
      math: [{ name: 'futureMetric', value: 0, unit: 'm' }],
    },
  };
  const view = await render(<AirCheckScreen />);
  const values = view.root
    .findAllByType(ValueRow)
    .map((row) => [property(row, 'label'), property(row, 'value')]);
  expect(values).toEqual(
    expect.arrayContaining([
      ['Temperature', '0 °C'],
      ['Humidity', '0 %'],
      ['Station', 'Not available'],
      ['Quality check', 'Not available'],
      ['Source pressure field', 'Not available'],
      ['Temperature quality', 'temperature-quality'],
      ['Observation source', 'https://example.test/observation'],
    ]),
  );
  await act(async () => {
    await invoke(view.root.findByType(ListRow), 'onPress');
  });
  expect(
    view.root.findAllByType(ValueRow).find((row) => property(row, 'label') === 'futureMetric')?.props.value,
  ).toBe('0 m');
  await act(async () => view.unmount());
});

test('Air Check preserves diagnostic fields when the weather response fails', async () => {
  required(mockBoard).fusion.airCheck = {
    state: 'weatherFailure',
    ranAt: '2026-10-11T12:00:00Z',
    reason: 'weatherProviderFailure',
    stage: 'observation',
    stationID: 'STATION',
    observedAt: null,
    receivedAt: '2026-10-11T12:00:00Z',
    httpStatus: null,
    failingField: 'pressure',
    decodingPath: 'properties.pressure',
  };
  const view = await render(<AirCheckScreen />);
  const values = view.root
    .findAllByType(ValueRow)
    .map((row) => [property(row, 'label'), property(row, 'value')]);
  expect(values).toEqual(
    expect.arrayContaining([
      ['Station', 'STATION'],
      ['Failing field', 'pressure'],
      ['Decoding path', 'properties.pressure'],
      ['HTTP status', 'Not available'],
    ]),
  );
  expect(view.root.findAllByType(ListRow)).toHaveLength(0);
  await act(async () => view.unmount());
});

test.each(['session', 'board'] as const)(
  'Three Proofs distinguishes opening, %s failure, waiting and an unsigned reading',
  async (source) => {
    mockBoard = null;
    const view = await render(<ThreeProofsScreen />);
    expect(words(view)).toContain('Opening sensors…');
    expect(words(view)).not.toContain('This reading carries no receipt');
    if (source === 'session') mockFailure = 'Sensor session unavailable';
    else mockStateFailure = 'Sensor board unavailable';
    await act(async () => view.update(<ThreeProofsScreen />));
    expect(words(view)).toContain('Not available');
    expect(words(view)).not.toContain('Opening sensors…');
    expect(words(view)).not.toContain('This reading carries no receipt');
    expect(words(view)).toContain(
      source === 'session' ? 'Sensor session unavailable' : 'Sensor board unavailable',
    );
    mockFailure = null;
    mockStateFailure = null;
    mockBoard = sensorBoardFixture();
    await act(async () => view.update(<ThreeProofsScreen />));
    expect(words(view)).toContain('Waiting for a reading from the Sensors tab.');
    expect(words(view)).not.toContain('This reading carries no receipt');
    mockBoard.reading = continuityReading();
    await act(async () => view.update(<ThreeProofsScreen />));
    expect(words(view)).toContain('This reading carries no receipt');
    expect(words(view)).not.toContain('Waiting for a reading from the Sensors tab.');
    expect(mockPerform).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  },
);

test('Three Proofs shows the current board receipt, retains it on refresh failure and removes stale evidence', async () => {
  const board = required(mockBoard);
  board.fusion.continuity = { state: 'evaluated', result: continuityResult() };
  board.fusion.receipt = {
    ...continuityResult().receipt,
    publicKeyHash: 'current-key',
    payloadHash: 'current-payload',
    root: 'current-root',
    previousRoot: 'previous-root',
    leafIndex: 2,
    leafCount: 5,
    secureHardware: true,
    locallyVerified: true,
    attestationState: 'pending-challenge',
  };
  const view = await render(<ThreeProofsScreen />);
  expect(words(view)).toContain('current-key');
  expect(words(view)).not.toContain('synthetic-key');
  expect(summaries(view)).toEqual([
    'Secure Enclave',
    'current-key',
    'Checks out',
    'pending-challenge',
    'current-payload',
    'previous-root',
    'current-root',
    '3 / 5',
  ]);
  mockStateFailure = 'Refresh failed';
  await act(async () => view.update(<ThreeProofsScreen />));
  expect(words(view)).toContain('Refresh failed');
  expect(words(view)).toContain('current-key');
  board.fusion.receipt = continuityResult().receipt;
  await act(async () => view.update(<ThreeProofsScreen />));
  expect(words(view)).not.toContain('current-key');
  expect(summaries(view)).toEqual([
    'Software (this phone has no enclave)',
    'synthetic-key',
    'Does not check out',
    'notRequested',
    'synthetic-payload',
    'Not available',
    'synthetic-root',
    '1 / 1',
  ]);
  board.fusion.receipt = null;
  board.reading = continuityReading();
  await act(async () => view.update(<ThreeProofsScreen />));
  expect(words(view)).toContain('This reading carries no receipt');
  expect(words(view)).not.toContain('synthetic-key');
  expect(view.root.findAllByType(ValueRow)).toHaveLength(0);
  mockBoard = null;
  await act(async () => view.update(<ThreeProofsScreen />));
  expect(view.root.findAllByType(ValueRow)).toHaveLength(0);
  expect(words(view)).not.toContain('synthetic-key');
  expect(words(view)).not.toContain('This reading carries no receipt');
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Three Proofs keeps its five accessible explanations and one receipt limit without obsolete implementation prose', async () => {
  const view = await render(<ThreeProofsScreen />);
  const headings = view.root
    .findAllByType(Text)
    .filter((node) => property(node, 'accessibilityRole') === 'header')
    .map((node) => property(node, 'children'));
  expect(headings).toEqual([
    'What each proof can establish',
    '1. Device evidence',
    '2. Presence evidence',
    '3. Identity evidence',
    'What the three make together',
    'What can be verified',
    'What makes it the same phone',
  ]);
  const text = view.root.findAllByType(Text).map((node) => property(node, 'children'));
  expect(
    text.filter(
      (value) => typeof value === 'string' && value.includes('does not independently prove device identity'),
    ),
  ).toHaveLength(1);
  for (const stale of [
    '.swift',
    'tools/verify-evidence.py',
    'not shown in this app yet',
    'Document capture and visits live in the Pulse app',
    'button beside the export',
    'Face ID at every app open',
    'until the third proof is signed alongside it',
    'their authenticated use of a phone',
    'Face ID supplies recurring authentication',
    'all destroy the key',
    'nothing can be inserted or re-dated afterwards',
  ]) {
    expect(words(view)).not.toContain(stale);
  }
  expect(words(view)).toContain(
    'These separate results are not automatically a single verified identity claim.',
  );
  expect(words(view)).toContain('not a probability that a named person is present');
  expect(words(view)).toContain('requires an independently trusted checkpoint');
  expect(words(view)).toContain('does not by itself prove that the named person was at that place');
  expect(words(view)).toContain('Separate results on this screen do not establish that relationship');
  expect(words(view)).toContain('whether that key uses secure hardware or software');
  expect(words(view)).toContain('Reinstalling the app alone does not establish that the key was erased');
  expect(words(view)).toContain('does not independently establish trusted time or completeness');
  const prose = view.root.findAllByType(TextRow).map((node) => property(node, 'text'));
  const deviceSupport = prose.findIndex(
    (text) => typeof text === 'string' && text.startsWith('A persistent cryptographic identity'),
  );
  const deviceLimit = prose.findIndex(
    (text) => typeof text === 'string' && text.startsWith('The device key identifies the signer'),
  );
  const deviceMechanism = prose.findIndex(
    (text) => typeof text === 'string' && text.startsWith('Evidence is signed with a device key'),
  );
  expect(deviceSupport).toBeGreaterThan(-1);
  expect(deviceLimit).toBeGreaterThan(deviceSupport);
  expect(deviceMechanism).toBeGreaterThan(deviceLimit);
  expect(words(view)).toContain('a counter cannot reveal readings removed from the end');
  expect(words(view)).not.toContain('It no longer does: every reading carries the counter');
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Three Proofs uses one shared scrolling container and leaves navigation to the native header', async () => {
  const view = await render(
    <PageHeaderContext.Provider value="native">
      <ThreeProofsScreen />
    </PageHeaderContext.Provider>,
  );
  expect(view.root.findAllByType(Page)).toHaveLength(1);
  expect(property(view.root.findByType(Page), 'testID')).toBe('fusion-proofs');
  expect(view.root.findAllByType(ScrollView)).toHaveLength(1);
  expect(view.root.findAllByProps({ testID: 'page-title' })).toHaveLength(0);
  expect(view.root.findAllByType(Action)).toHaveLength(0);
  expect(view.root.findAllByType(ButtonRow)).toHaveLength(0);
  expect(view.root.findAllByType(ListRow)).toHaveLength(0);
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Fusion keeps one content lead below native navigation and above failure and result sections', async () => {
  mockFailure = 'Refresh failed';
  const view = await render(
    <PageHeaderContext.Provider value="native">
      <FusionScreen onOpen={jest.fn()} />
    </PageHeaderContext.Provider>,
  );
  expect(view.root.findAllByType(PageLead)).toHaveLength(1);
  expect(property(view.root.findByType(PageLead), 'title')).toBe('What the readings tell you');
  expect(view.root.findAllByProps({ testID: 'page-title' })).toHaveLength(0);
  const rendered = words(view);
  expect(rendered.indexOf('What the readings tell you')).toBeLessThan(rendered.indexOf('Refresh failed'));
  expect(rendered.indexOf('Refresh failed')).toBeLessThan(rendered.indexOf('Air check'));
  expect(rendered).toContain(
    'Compare air pressure with local weather and review how readings relate over time.',
  );
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
  const details = await render(<ThreeProofsScreen />);
  expect(details.root.findAllByType(PageLead)).toHaveLength(1);
  await act(async () => details.unmount());
});

test.each([
  ['Air Check', () => <AirCheckScreen />, 'How the air readings compare'],
  ['Continuity', () => <ContinuityScreen onOverTime={jest.fn()} />, 'How your readings relate'],
  ['Over Time', () => <OverTimeScreen />, 'How continuity changes over time'],
  ['Three Proofs', () => <ThreeProofsScreen />, 'What each proof can establish'],
] as const)('%s keeps its lead during loading and failure', async (_name, screen, headline) => {
  mockBoard = null;
  const view = await render(screen());
  const lead = view.root.findByType(PageLead);
  expect(property(lead, 'title')).toBe(headline);
  expect(property(lead, 'description')).toEqual(expect.any(String));
  mockFailure = 'Could not load evidence';
  await act(async () => view.update(screen()));
  expect(view.root.findAllByType(PageLead)).toHaveLength(1);
  expect(property(view.root.findByType(PageLead), 'title')).toBe(headline);
  expect(words(view).indexOf(headline)).toBeLessThan(words(view).indexOf('Could not load evidence'));
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Fusion landing contains two summary disclosures followed by two explanatory links, without duplicated detail prose', async () => {
  const view = await render(<FusionScreen onOpen={jest.fn()} />);
  const sections = view.root.findAllByType(ListSection);
  expect(sections).toHaveLength(2);
  expect(
    sections.map((section) => section.findAllByType(ListRow).map((row) => property(row, 'label'))),
  ).toEqual([
    ['Air check', 'Continuity'],
    ['What each proof carries, and how they join', 'Words used here'],
  ]);
  expect(property(required(sections[0]), 'header')).toBeUndefined();
  expect(property(required(sections[1]), 'header')).toBe('Understand the evidence');
  expect(view.root.findAllByType(ValueRow)).toHaveLength(0);
  const rendered = words(view);
  for (const prose of [
    'Three proofs, not one',
    'Which phone —',
    'Where it was —',
    'Who the person is —',
    'Local verification checks this reading',
  ])
    expect(rendered).not.toContain(prose);
  for (const label of ['Air check, Not run yet', 'Continuity, Not run yet']) {
    expect(
      view.root.findAll(
        (node) =>
          property(node, 'accessibilityRole') === 'button' && property(node, 'accessibilityLabel') === label,
      ).length,
    ).toBeGreaterThan(0);
  }
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Air Check gives the answer before the diagram and keeps calculations after the evidence', async () => {
  required(mockBoard).fusion.airCheck = {
    state: 'compared',
    ranAt: '2026-10-11T12:00:00Z',
    comparison: airComparison(),
  };
  const view = await render(<AirCheckScreen />);
  const sections = view.root.findAllByType(ListSection);
  expect(property(required(sections[0]), 'header')).toBeUndefined();
  expect(property(required(sections[0]), 'footer')).toBeUndefined();
  const rendered = words(view);
  expect(rendered.indexOf("Doesn't match the area")).toBeGreaterThan(-1);
  expect(rendered.indexOf("Doesn't match the area")).toBeLessThan(
    rendered.indexOf('Position, Area report, Barometer'),
  );
  expect(required(sections.at(-1)).findAllByType(ListRow)).toHaveLength(1);
  expect(property(required(required(sections.at(-1)).findAllByType(ListRow)[0]), 'label')).toBe(
    'How this was worked out',
  );
  expect(rendered).not.toContain('Two sensors and a weather service in one answer.');
  await act(async () => view.unmount());
});

test('Continuity puts the answer before actions and evidence before receipt and calculation details', async () => {
  const view = await render(<ContinuityScreen onOverTime={jest.fn()} />);
  expect(property(required(view.root.findAllByType(ListSection)[0]), 'footer')).toBeUndefined();
  required(mockBoard).fusion.continuity = { state: 'evaluated', result: continuityResult() };
  await act(async () => view.update(<ContinuityScreen onOverTime={jest.fn()} />));
  const sections = view.root.findAllByType(ListSection);
  const answer = required(sections[0]);
  expect(answer.findAllByType(ListRow)).toHaveLength(0);
  expect(answer.findAll((node) => node.type === TextRow || node.type === ButtonRow)[0]?.type).toBe(TextRow);
  expect(required(sections[1]).findAllByType(ListRow)).toHaveLength(1);
  const headings = sections.map((node) => property(node, 'header'));
  expect(headings.indexOf('The estimate')).toBeLessThan(headings.indexOf('What makes it the same phone'));
  expect(property(required(sections.at(-1)), 'header')).toBe('Start again');
  const calculation = required(sections.at(-2));
  expect(calculation.findAllByType(ListRow)).toHaveLength(1);
  await act(async () => {
    invoke(required(calculation.findAllByType(ListRow)[0]), 'onPress');
  });
  expect(view.root.findAllByProps({ testID: 'fusion-math' }).length).toBeGreaterThan(0);
  required(mockBoard).fusion.continuity = { state: 'unavailable', reason: 'invalidReceipt' };
  await act(async () => view.update(<ContinuityScreen onOverTime={jest.fn()} />));
  expect(view.root.findAllByProps({ testID: 'fusion-math' })).toHaveLength(0);
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Continuity requires a session even when a reading is still present', async () => {
  required(mockBoard).reading = continuityReading();
  mockSessionId = null;
  const view = await render(<ContinuityScreen onOverTime={jest.fn()} />);
  for (const row of view.root.findAllByType(ButtonRow)) expect(property(row, 'disabled')).toBe(true);
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Over Time leads with projections and assumptions before background explanation', async () => {
  required(mockBoard).fusion.continuity = { state: 'evaluated', result: continuityResult() };
  const view = await render(<OverTimeScreen />);
  const sections = view.root.findAllByType(ListSection);
  expect(sections.map((section) => property(section, 'header'))).toEqual([
    'Illustrative projections',
    'What a gap costs',
    'What a reading is',
    'Two ways it can end',
  ]);
  const timeline = required(sections[0]);
  expect(property(timeline, 'footer')).toBeUndefined();
  expect(timeline.findAll((node) => node.type === TextRow || node.type === TitleRow)[0]?.type).toBe(TextRow);
  expect(words(view).indexOf('Illustrative projections, not recorded history')).toBeLessThan(
    words(view).indexOf('43%'),
  );
  expect(words(view)).not.toContain('No gap projection is available');
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Glossary stays static through sensor failures with every definition once in alphabetical order', async () => {
  mockBoard = null;
  const view = await render(
    <PageHeaderContext.Provider value="native">
      <GlossaryScreen />
    </PageHeaderContext.Provider>,
  );
  const original = words(view);
  mockFailure = 'Sensor owner failed';
  mockStateFailure = 'Collection refresh failed';
  mockBoard = sensorBoardFixture();
  await act(async () =>
    view.update(
      <PageHeaderContext.Provider value="native">
        <GlossaryScreen />
      </PageHeaderContext.Provider>,
    ),
  );
  expect(words(view)).toBe(original);
  expect(view.root.findAllByType(Page)).toHaveLength(1);
  expect(view.root.findAllByType(ScrollView)).toHaveLength(1);
  expect(property(view.root.findByType(PageLead), 'title')).toBe('Understand the evidence terms');
  expect(view.root.findAllByProps({ testID: 'page-title' })).toHaveLength(0);
  const sections = view.root.findAllByType(ListSection);
  expect(sections.map((node) => property(node, 'header'))).toEqual([
    'App Attest',
    'Canonical form',
    'Device signing key',
    'Hash',
    'Merkle chain',
    'Root',
    'Secure Enclave',
    'Signature',
  ]);
  for (const section of sections) {
    expect(section.findAllByType(TextRow)).toHaveLength(1);
    expect(property(section.findByType(TextRow), 'text')).toEqual(expect.any(String));
  }
  expect(words(view)).toContain('A valid prefix can still omit later readings');
  expect(words(view)).toContain('a matching root alone does not verify its signatures');
  expect(words(view)).toContain('does not independently establish that hardware custody or device identity');
  expect(words(view)).toContain('not proof that a server accepted it');
  expect(view.root.findAllByType(ButtonRow)).toHaveLength(0);
  expect(view.root.findAllByType(Action)).toHaveLength(0);
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});
