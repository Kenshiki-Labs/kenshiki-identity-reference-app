import type { Configuration } from '@kenshiki/identity-capture';
import { useState } from 'react';
import { AppState, Linking, Modal, Switch, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { sensorBoardFixture, sensorSnapshotFixture } from '../testing/SensorBoardFixtures';
import { actionSheets, invoke, property, required } from '../testing/support';
import { t } from '../locales/i18n';
import type { SensorBoardPresentation } from './SensorBoardController';
import { SensorDocumentationScreen } from './SensorBoardDocuments';
import { signalSummary } from './SensorBoardRows';
import { copy, hasDocumentation, moment, pageDoc, pages, type SensorPage, title } from './SensorPresentation';
import { SensorBoardScreen, SensorDetailScreen, SensorSession, SensorSettingsScreen } from './SensorScreen';
import { BarButton, ButtonRow, CheckRow, LinkRow, ListRow, ListSection, TextRow, ValueRow } from '../ui/List';
import { NativeSheet } from '../ui/NativeSheet';
import { PageLead } from '../ui/PageLead';

const mockPerform = jest.fn(async () => {});
const mockDispose = jest.fn(async () => {});
const mockSetActive = jest.fn(async () => {});
const mockOpen = jest.fn(async () => {});
let mockBoard = sensorBoardFixture();
let mockPublish: (value: SensorBoardPresentation) => void;
jest.mock('./SensorBoardController', () => ({
  SensorBoardController: jest
    .fn()
    .mockImplementation((_config: Configuration, changed: (value: SensorBoardPresentation) => void) => ({
      open: async () => {
        mockPublish = changed;
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
  IdentitySymbol: 'MockSymbol',
}));
const configuration: Configuration = {};
/** A row or bar button by its words: the screens draw actions as list rows, never as capsules. */
function button(view: ReactTestRenderer, label: string) {
  return required(
    [ListRow, ButtonRow, BarButton]
      .flatMap((type) => view.root.findAllByType(type))
      .find((node) => node.props.label === label),
  );
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
        <SensorDetailScreen page={page} onOpenDocumentation={jest.fn()} />
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
    expect(button(view, label)).toBeDefined();
  await act(async () => {
    invoke(button(view, 'Location'), 'onPress');
  });
  await act(async () => {
    invoke(button(view, 'Get one fix'), 'onPress');
  });
  expect(mockPerform).toHaveBeenCalledWith({ action: 'location', consent: true });
  const detail = view.root.findByProps({ testID: 'sensor-detail' });
  expect(JSON.stringify(view.toJSON())).not.toContain('Apple APIs');
  expect(button(view, 'API documentation')).toBeDefined();
  expect(detail.findAll((node) => node.props.label === 'Motion')).toHaveLength(0);
  expect(mockOpen).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
  expect(mockDispose).toHaveBeenCalledTimes(1);
});
test('permission switch requests once or opens OS Settings; destructive erase requires confirmation', async () => {
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  const sheets = actionSheets();
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
  // An action sheet asks first, its destructive choice first; keeping does nothing.
  expect(sheets.last().options).toEqual(['Erase local sensor data', 'Cancel']);
  expect(mockPerform).not.toHaveBeenCalledWith({ action: 'erase', consent: true });
  await act(async () => sheets.last().choose(1));
  expect(mockPerform).not.toHaveBeenCalledWith({ action: 'erase', consent: true });
  await act(async () => {
    invoke(button(view, 'Erase local sensor data'), 'onPress');
  });
  await act(async () => sheets.last().choose(0));
  expect(mockPerform).toHaveBeenCalledWith({ action: 'erase', consent: true });
  await act(async () => view.unmount());
  settings.mockRestore();
  sheets.spy.mockRestore();
});

test('units stay selectable without a Pause or Resume sensors CTA', async () => {
  const view = await render('settings');
  const choices = view.root.findAllByType(CheckRow);
  const rows = choices.map((node): { label: unknown; selected: unknown } => ({
    label: node.props.label,
    selected: node.props.selected,
  }));
  expect(rows).toEqual([
    { label: 'Follow phone', selected: true },
    { label: 'Metric', selected: false },
    { label: 'Imperial', selected: false },
  ]);
  await act(async () => {
    invoke(required(choices[1]), 'onPress');
  });
  expect(mockPerform).toHaveBeenCalledWith({ action: 'units', units: 'metric' });
  expect(JSON.stringify(view.toJSON())).not.toContain('Pause sensors');
  expect(JSON.stringify(view.toJSON())).not.toContain('Resume sensors');
  await act(async () => view.unmount());
});

test('settings offer no control that alters a signed reading, in any build', async () => {
  const view = await render('settings');
  expect(view.root.findAllByProps({ testID: 'sensor-tamper' })).toHaveLength(0);
  expect(JSON.stringify(view.toJSON())).not.toContain('Tamper');
  expect(JSON.stringify(view.toJSON())).toContain('Prepare export');
  await act(async () => view.unmount());
});
test('permission-prompt inactive state does not pause; background does', async () => {
  const listener = jest.spyOn(AppState, 'addEventListener');
  const view = await render();
  const callback = required(listener.mock.calls[0])[1];
  mockSetActive.mockClear();
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
    unmetTerms: ['finiteTimestamp'],
  };
  mockBoard.location.answeredAt = new Date().toISOString();
  mockBoard.location.deliveredCount = 3;
  mockBoard.location.permissionAtDelivery = 'given';
  mockBoard.location.precisionAtDelivery = 'full';
  mockBoard.location.trail = [mockBoard.location.fix];
  mockBoard.location.estimateID = 'fix-1';
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Location'), 'onPress');
  });
  const rendered = JSON.stringify(view.toJSON());
  expect(rendered).toContain('37.123456789');
  expect(rendered).toContain('Not valid');
  expect(rendered).toContain('No real time');
  expect(rendered).toContain('Positions received');
  await act(async () => {
    invoke(button(view, 'Clear map trail'), 'onPress');
  });
  expect(mockPerform).toHaveBeenCalledWith({ action: 'clearTrail', consent: true });
  await act(async () => view.unmount());
});

test.each(pages)(
  'sensor detail %s has one lead and does not repeat its explanation in the values',
  async (page) => {
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(<SensorDetailScreen page={page} onOpenDocumentation={jest.fn()} />);
    });
    expect(view.root.findAllByType(PageLead)).toHaveLength(1);
    expect(view.root.findByType(PageLead).props.title).toBe(title(page));
    expect(view.root.findByType(PageLead).props.description).toBe(copy(`meaning.${page}`));
    await act(async () => {
      view.update(
        <SensorSession configuration={configuration} open>
          <SensorDetailScreen page={page} onOpenDocumentation={jest.fn()} />
        </SensorSession>,
      );
    });
    expect(
      view.root.findAllByType(Text).filter((node) => node.props.children === copy(`meaning.${page}`)),
    ).toHaveLength(1);
    expect(mockPerform).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  },
);

test('overview groups disclosures without embedding detail tables, controls or documentation', async () => {
  const view = await render();
  expect(view.root.findAllByType(ListRow).map((node) => property(node, 'label'))).toEqual([
    'Status',
    'Audio route',
    'Calls',
    'Network',
    'Device',
    'Magnetic field',
    'Motion',
    'Mobile network',
    'Battery and heat',
    'Barometer',
    'Bluetooth',
    'Location',
    'Weather',
  ]);
  expect(
    view.root
      .findAllByType(ListSection)
      .map((node) => property(node, 'header'))
      .filter(Boolean),
  ).toEqual(['No permission needed', 'Needs your permission']);
  expect(view.root.findAllByType(ValueRow)).toHaveLength(0);
  expect(view.root.findAllByType(ButtonRow)).toHaveLength(0);
  expect(JSON.stringify(view.toJSON())).not.toContain('Apple APIs');
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test.each(pages)('overview %s opens its own detail without issuing a command', async (page) => {
  const view = await render();
  await act(async () => {
    invoke(button(view, title(page)), 'onPress');
  });
  expect(view.root.findByType(PageLead).props.title).toBe(title(page));
  expect(view.root.findAllByProps({ testID: 'sensor-detail' }).length).toBeGreaterThan(0);
  expect(mockPerform).not.toHaveBeenCalled();
  expect(mockOpen).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});

test('overview updates permissions, failures and paused collection without requesting anything', async () => {
  const view = await render();
  expect(property(button(view, 'Barometer'), 'status')).toBe('Not asked yet');
  expect(property(button(view, 'Weather'), 'status')).toBe('Not configured');
  mockBoard.permissions.motion = 'refused';
  mockBoard.permissions.bluetooth = 'unavailable';
  mockBoard.permissions.location = 'given';
  mockBoard.collection.paused = true;
  mockBoard.weather.state = 'failed';
  mockBoard.weather.failure = 'providerNotConfigured';
  mockBoard.location.failure = 'locationUnavailable';
  await act(async () =>
    mockPublish({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' }),
  );
  expect(property(button(view, 'Barometer'), 'status')).toBe('Denied');
  expect(property(button(view, 'Bluetooth'), 'status')).toBe('Unavailable');
  expect(property(button(view, 'Status'), 'status')).toBe('Paused');
  expect(property(button(view, 'Weather'), 'status')).toBe('Weather is not configured in this host.');
  expect(property(button(view, 'Location'), 'status')).toBe('Location is unavailable.');
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('summary distinguishes absent, unsupported, zero and invalid observations and follows units', () => {
  const board = sensorBoardFixture();
  expect(signalSummary(board, 'audioRoute')).toBe('Waiting for a reading.');
  board.mediaOutput = { support: { status: 'unavailable' }, routeClass: 'speaker' };
  expect(signalSummary(board, 'audioRoute')).toBe('Unavailable');
  board.reading = sensorSnapshotFixture();
  expect(signalSummary(board, 'thermalAndPower')).toContain('0 %');
  expect(signalSummary(board, 'callActivity')).toContain('0');
  expect(signalSummary(board, 'motion')).toBe('Not read yet');
  expect(signalSummary(board, 'barometer')).toContain('1,000 hPa');
  board.units = 'imperial';
  expect(signalSummary(board, 'barometer')).toContain('29.53 inHg');
  delete board.reading.battery.level;
  expect(signalSummary(board, 'thermalAndPower')).toContain('—');
  board.reading.barometer.pressureKilopascals = Number.NaN;
  expect(signalSummary(board, 'barometer')).toBe('Not valid');
  board.reading.barometer.support.status = 'not_supported_by_platform';
  expect(signalSummary(board, 'barometer')).toBe('Not on this device');
});

test.each([
  ['notRequested', 'Not requested'],
  ['available', 'Report available'],
  ['failed', 'Report unavailable'],
  ['notConfigured', 'Not configured'],
] as const)('overview weather %s is explicit even without provider failure text', async (state, expected) => {
  mockBoard.weather.state = state;
  const view = await render();
  expect(property(button(view, 'Weather'), 'status')).toBe(expected);
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('collection failure overrides idle or paused status and remains visible in detail', async () => {
  mockBoard.collection.failure = 'collectionFailed';
  mockBoard.collection.paused = true;
  const view = await render();
  expect(property(button(view, 'Status'), 'status')).toBe(copy('collection.failure'));
  await act(async () => {
    invoke(button(view, 'Status'), 'onPress');
  });
  expect(JSON.stringify(view.toJSON())).toContain(copy('collection.failure'));
  await act(async () => view.unmount());
});

test.each(pages)(
  '%s keeps interpretation on L2 and only offers documentation when available',
  async (page) => {
    const open = jest.fn();
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(<SensorDetailScreen page={page} onOpenDocumentation={open} />);
    });
    expect(view.root.findAllByType(LinkRow)).toHaveLength(0);
    const docs = pageDoc(page);
    const headers = view.root
      .findAllByType(ListSection)
      .map((node) => property(node, 'header'))
      .filter(Boolean);
    expect(headers).toEqual([
      ...(docs?.noteKeys.length ? [copy('page.header.about')] : []),
      ...(docs?.limitKeys.length ? [copy('page.header.limits')] : []),
    ]);
    const text = view.root.findAllByType(TextRow).map((node) => property(node, 'text'));
    for (const key of [...(docs?.noteKeys ?? []), ...(docs?.limitKeys ?? [])])
      expect(text).toContain(copy(key));
    const links = view.root
      .findAllByType(ListRow)
      .filter((node) => property(node, 'label') === 'API documentation');
    expect(links).toHaveLength(hasDocumentation(page) ? 1 : 0);
    if (hasDocumentation(page)) {
      await act(async () => {
        invoke(required(links[0]), 'onPress');
      });
      expect(open).toHaveBeenCalledTimes(1);
    }
    expect(mockPerform).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  },
);

test.each(pages.filter(hasDocumentation))(
  '%s L3 preserves every platform reference and exact URL',
  async (page) => {
    const docs = required(pageDoc(page));
    const urls = [
      ...docs.apis.map((api) => api.url),
      ...(docs.usageKey ? [docs.usageKey.url] : []),
      ...docs.checks.map((check) => check.url),
      ...(docs.hardware ? [docs.hardware.url] : []),
      ...(docs.updates ? [docs.updates.url] : []),
    ];
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(<SensorDocumentationScreen page={page} />);
    });
    const rows = view.root.findAllByType(LinkRow);
    const headers = view.root
      .findAllByType(ListSection)
      .map((node) => property(node, 'header'))
      .filter(Boolean);
    expect(headers).toEqual([
      ...(docs.apis.length ? [copy('page.header.apis')] : []),
      ...(docs.usageKey || docs.checks.length ? [copy('page.header.permission')] : []),
      ...(docs.hardware ? [copy('page.header.hardware')] : []),
      ...(docs.updates ? [copy('page.header.updates')] : []),
    ]);
    expect(rows).toHaveLength(urls.length);
    for (const row of rows)
      await act(async () => {
        invoke(row, 'onPress');
      });
    expect(openURL.mock.calls.map(([url]) => url)).toEqual(urls);
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockPerform).not.toHaveBeenCalled();
    expect(view.root.findAllByType(PageLead)).toHaveLength(1);
    await act(async () => view.unmount());
    openURL.mockRestore();
  },
);

test('documentation link failure is visible on L3 and clears on a successful retry', async () => {
  const openURL = jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<SensorDocumentationScreen page="motion" />);
  });
  const link = required(view.root.findAllByType(LinkRow)[0]);
  await act(async () => {
    invoke(link, 'onPress');
  });
  expect(view.root.findAllByType(TextRow).map((node) => property(node, 'text'))).toContain(
    'The documentation could not be opened.',
  );
  await act(async () => {
    invoke(link, 'onPress');
  });
  expect(view.root.findAllByType(TextRow).map((node) => property(node, 'text'))).not.toContain(
    'The documentation could not be opened.',
  );
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
  openURL.mockRestore();
});

test('identity settings content remains available while the sensor board opens', async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <SensorSettingsScreen>
        <TextRow text="Identity settings" />
      </SensorSettingsScreen>,
    );
  });
  expect(view.root.findAllByType(TextRow).map((node) => property(node, 'text'))).toContain(
    'Identity settings',
  );
  await act(async () => {
    view.update(
      <SensorSession configuration={configuration} open>
        <SensorSettingsScreen>
          <TextRow text="Identity settings" />
        </SensorSettingsScreen>
      </SensorSession>,
    );
  });
  expect(
    view.root.findAllByType(TextRow).filter((node) => property(node, 'text') === 'Identity settings'),
  ).toHaveLength(1);
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Status orders current state and failure before last read, recovers without commands, and clears stale timestamps', async () => {
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Status'), 'onPress');
  });
  await act(async () => mockPublish({ board: null, busy: false, failure: null, sessionId: null }));
  expect(JSON.stringify(view.toJSON())).toContain('Opening');
  await act(async () =>
    mockPublish({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' }),
  );
  const rows = () =>
    view.root
      .findAllByType(ValueRow)
      .map((node) => ({ label: property(node, 'label'), value: property(node, 'value') }));
  const publish = async (busy = false, failure: string | null = null) => {
    await act(async () => mockPublish({ board: mockBoard, busy, failure, sessionId: 'sensor-session' }));
  };
  expect(rows()).toEqual([
    { label: 'Now', value: 'Collection enabled' },
    { label: 'Last read', value: '—' },
  ]);
  mockBoard.collection.collectedAt = '2026-10-11T12:34:56Z';
  mockBoard.collection.failure = 'collectionFailed';
  await publish();
  const text = JSON.stringify(view.toJSON());
  expect(text.indexOf('Now')).toBeLessThan(text.indexOf(copy('collection.failure')));
  expect(text.indexOf(copy('collection.failure'))).toBeLessThan(text.indexOf('Last read'));
  expect(rows()[1]).toEqual({ label: 'Last read', value: moment('2026-10-11T12:34:56Z') });
  expect(view.root.findAllByType(TextRow).filter((node) => property(node, 'alert') === true)).toHaveLength(1);
  mockBoard.collection.failure = null;
  await publish(true);
  expect(rows()[0]).toEqual({ label: 'Now', value: 'Updating…' });
  expect(JSON.stringify(view.toJSON())).not.toContain(copy('collection.failure'));
  mockBoard.collection.paused = true;
  await publish(true);
  expect(rows()[0]).toEqual({ label: 'Now', value: 'Paused' });
  mockBoard.collection.paused = false;
  await publish();
  expect(rows()[0]).toEqual({ label: 'Now', value: 'Collection enabled' });
  await act(async () =>
    mockPublish({ board: null, busy: false, failure: 'Collection unavailable', sessionId: null }),
  );
  expect(rows()).toEqual([]);
  expect(JSON.stringify(view.toJSON())).toContain('Collection unavailable');
  expect(JSON.stringify(view.toJSON())).not.toContain('Opening');
  mockBoard = sensorBoardFixture();
  await publish();
  expect(rows()[1]).toEqual({ label: 'Last read', value: '—' });
  expect(JSON.stringify(view.toJSON())).not.toContain('Collection unavailable');
  expect(JSON.stringify(view.toJSON())).toContain('Collected readings are signed and saved on this phone');
  expect(JSON.stringify(view.toJSON())).not.toContain('Readings are held in memory only');
  expect(view.root.findAllByType(ListRow)).toHaveLength(0);
  expect(JSON.stringify(view.toJSON())).not.toContain('Trying again');
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Status acquisition rejection shows the failure without a perpetual opening state', async () => {
  mockOpen.mockRejectedValueOnce(new Error('private native failure'));
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <SensorSession configuration={configuration} open>
        <SensorDetailScreen page="status" onOpenDocumentation={jest.fn()} />
      </SensorSession>,
    );
  });
  const rendered = JSON.stringify(view.toJSON());
  expect(rendered).toContain(t('sensors.failure.open'));
  expect(rendered).not.toContain(t('sensors.opening'));
  expect(rendered).not.toContain('private native failure');
  expect(view.root.findAllByType(ValueRow)).toHaveLength(0);
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Audio route maps independent output once and distinguishes retained counters, false, zero and missing', async () => {
  mockBoard.reading = null;
  mockBoard.mediaOutput = {
    support: { status: 'available' },
    routeClass: 'speaker',
    external: false,
    otherAudioPlaying: true,
    routeChangeCount: 7,
    externalRouteChangeCount: 3,
  };
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Audio route'), 'onPress');
  });
  const rows = () =>
    view.root.findAllByType(ValueRow).map((node) => [property(node, 'label'), property(node, 'value')]);
  const publish = async () => {
    await act(async () =>
      mockPublish({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' }),
    );
  };
  expect(rows()).toEqual([
    ['Plays through', 'Speaker'],
    ['External', 'No'],
    ['Other audio playing', 'Yes'],
    ['Route changes', '7'],
    ['External route changes', '3'],
    ['Status', 'Available'],
  ]);
  const paragraphs = view.root.findAllByType(Text).map((node) => property(node, 'children'));
  expect(
    paragraphs.filter(
      (text) =>
        text === 'Both change counts are saved on this phone and cleared by Erase on the Settings tab.',
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(view.toJSON())).not.toContain('Connect headphones and each count goes up by one');
  mockBoard.mediaOutput = {
    support: { status: 'not_collected' },
    routeClass: 'none',
    external: false,
    otherAudioPlaying: false,
    routeChangeCount: 0,
    externalRouteChangeCount: 3,
  };
  await publish();
  expect(rows()).toEqual([
    ['Plays through', 'None'],
    ['External', 'No'],
    ['Other audio playing', 'No'],
    ['Route changes', '0'],
    ['External route changes', '3'],
    ['Status', 'Not read yet'],
  ]);
  mockBoard.mediaOutput = {
    support: { status: 'available' },
    routeClass: 'bluetooth',
    external: true,
    otherAudioPlaying: false,
    routeChangeCount: 8,
    externalRouteChangeCount: 4,
  };
  await publish();
  expect(rows().slice(0, 5)).toEqual([
    ['Plays through', 'Bluetooth'],
    ['External', 'Yes'],
    ['Other audio playing', 'No'],
    ['Route changes', '8'],
    ['External route changes', '4'],
  ]);
  mockBoard.mediaOutput = { support: { status: 'not_supported_by_platform' } };
  await publish();
  expect(rows()).toEqual([
    ['Plays through', '—'],
    ['External', '—'],
    ['Other audio playing', '—'],
    ['Route changes', '—'],
    ['External route changes', '—'],
    ['Status', 'Not on this device'],
  ]);
  mockBoard.mediaOutput = null;
  await publish();
  expect(rows()).toEqual([]);
  expect(JSON.stringify(view.toJSON())).toContain('Waiting for a reading.');
  expect(button(view, 'API documentation')).toBeDefined();
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Calls presents saved observations without implying live state, preserving independent counts and timestamps', async () => {
  mockBoard.reading = sensorSnapshotFixture();
  const reading = required(mockBoard.reading);
  reading.telephony = {
    support: { status: 'available' },
    radioGenerations: [],
    activeCallCount: 3,
    connectedCallCount: 2,
    heldCallCount: 1,
    callEventCount: 17,
    lastCallEventAt: '2026-10-10T10:00:00Z',
    callObserverStartedAt: '2026-10-11T12:00:00Z',
  };
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Calls'), 'onPress');
  });
  const rows = () =>
    view.root.findAllByType(ValueRow).map((node) => [property(node, 'label'), property(node, 'value')]);
  const publish = async () => {
    await act(async () =>
      mockPublish({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' }),
    );
  };
  expect(rows()).toEqual([
    ['Active calls', '3'],
    ['Connected calls', '2'],
    ['Calls on hold', '1'],
    ['Changes seen', '17'],
    ['Last change', moment('2026-10-10T10:00:00Z')],
    ['Observer last started', moment('2026-10-11T12:00:00Z')],
  ]);
  const retained = rows();
  reading.telephony.support = { status: 'not_collected' };
  await publish();
  expect(rows()).toEqual(retained);
  expect(JSON.stringify(view.toJSON())).toContain('last observed call counts');
  expect(JSON.stringify(view.toJSON())).toContain('Saved counts may be older than the current call state');
  expect(JSON.stringify(view.toJSON())).not.toContain('Make or end a call and the counts change');
  reading.telephony = {
    support: { status: 'available' },
    radioGenerations: [],
    activeCallCount: 0,
    connectedCallCount: 0,
    heldCallCount: 0,
    callEventCount: 0,
  };
  await publish();
  expect(rows()).toEqual([
    ['Active calls', '0'],
    ['Connected calls', '0'],
    ['Calls on hold', '0'],
    ['Changes seen', '0'],
    ['Last change', '—'],
    ['Observer last started', '—'],
  ]);
  reading.telephony = { support: { status: 'available' }, radioGenerations: ['5G'] };
  await publish();
  expect(rows()).toEqual([
    ['Active calls', '—'],
    ['Connected calls', '—'],
    ['Calls on hold', '—'],
    ['Changes seen', '—'],
    ['Last change', '—'],
    ['Observer last started', '—'],
  ]);
  mockBoard.reading = null;
  await publish();
  expect(rows()).toEqual([]);
  expect(JSON.stringify(view.toJSON())).toContain('Waiting for a reading.');
  expect(button(view, 'API documentation')).toBeDefined();
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Network preserves literal SSIDs, hides tokens, and maps connection and familiarity states independently', async () => {
  mockBoard.reading = sensorSnapshotFixture();
  const reading = required(mockBoard.reading);
  reading.connectivity = {
    support: { status: 'available' },
    pathStatus: 'satisfied',
    unsatisfiedReason: 'not_available',
    interfaceTypes: ['wifi', 'cellular'],
    availableInterfaceTypes: [],
    perInterfacePathStatuses: {},
    expensive: false,
    constrained: true,
    wifiSSID: 'Office_WiFi',
    wifiFamiliarity: 'known',
    wifiNetworkHash: 'PRIVATE-TOKEN-DO-NOT-DISPLAY',
  };
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Network'), 'onPress');
  });
  const rows = () =>
    view.root.findAllByType(ValueRow).map((node) => [property(node, 'label'), property(node, 'value')]);
  const publish = async () => {
    await act(async () =>
      mockPublish({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' }),
    );
  };
  expect(rows()).toEqual([
    ['Connection', 'Connected'],
    ['Connection types', 'Wi-Fi, Mobile data'],
    ['Costly network', 'No'],
    ['Low Data Mode', 'Yes'],
    ['Wi-Fi name', 'Office_WiFi'],
    ['Wi-Fi seen before', 'Seen before'],
    ['Private Wi-Fi code', 'Made'],
    ['Status', 'Available'],
  ]);
  expect(JSON.stringify(view.toJSON())).not.toContain('PRIVATE-TOKEN-DO-NOT-DISPLAY');
  for (const name of ['speaker', 'given']) {
    reading.connectivity.wifiSSID = name;
    await publish();
    expect(rows()).toContainEqual(['Wi-Fi name', name]);
  }
  for (const [state, label] of [
    ['unknown', 'Unknown'],
    ['unavailable', "Can't tell"],
    ['new', 'First observed here'],
    ['known', 'Seen before'],
    ['familiar', 'Often'],
  ] as const) {
    reading.connectivity.wifiFamiliarity = state;
    await publish();
    expect(rows()).toContainEqual(['Wi-Fi seen before', label]);
  }
  reading.connectivity.pathStatus = 'unsatisfied';
  reading.connectivity.unsatisfiedReason = 'wifi_denied';
  await publish();
  expect(rows().slice(0, 2)).toEqual([
    ['Connection', 'Not connected'],
    ['Why not connected', 'Wi-Fi off for this app'],
  ]);
  reading.connectivity = {
    support: { status: 'not_collected' },
    pathStatus: 'requires_connection',
    unsatisfiedReason: 'not_available',
    interfaceTypes: [],
    availableInterfaceTypes: [],
    perInterfacePathStatuses: {},
  };
  await publish();
  expect(rows()).toEqual([
    ['Connection', 'Needs to connect'],
    ['Connection types', '—'],
    ['Costly network', '—'],
    ['Low Data Mode', '—'],
    ['Wi-Fi name', '—'],
    ['Wi-Fi seen before', '—'],
    ['Private Wi-Fi code', '—'],
    ['Status', 'Not read yet'],
  ]);
  delete reading.connectivity.pathStatus;
  await publish();
  expect(rows()[0]).toEqual(['Connection', '—']);
  expect(rows().some(([label]) => label === 'Why not connected')).toBe(false);
  reading.connectivity.pathStatus = 'unknown';
  await publish();
  expect(rows()[0]).toEqual(['Connection', 'Unknown']);
  mockBoard.reading = null;
  await publish();
  expect(rows()).toEqual([]);
  expect(JSON.stringify(view.toJSON())).toContain('Waiting for a reading.');
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Network explanation sheet opens, dismisses and reopens without collecting or exposing source paths', async () => {
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Network'), 'onPress');
  });
  const open = () => invoke(button(view, t('sensors.docs.howWorkedOut', { title: 'Network' })), 'onPress');
  await act(async () => {
    open();
  });
  expect(view.root.findAllByType(NativeSheet)).toHaveLength(1);
  const rendered = JSON.stringify(view.toJSON());
  expect(rendered).toContain('Wi-Fi name is separate and may be included in saved evidence');
  expect(rendered).toContain('Reading that history does not record a new visit');
  expect(rendered).not.toContain('.swift');
  expect(rendered).not.toContain('network is never stored');
  expect(rendered).not.toContain('answer here stays first seen');
  await act(async () => {
    invoke(view.root.findByType(Modal), 'onRequestClose');
  });
  expect(view.root.findAllByType(NativeSheet)).toHaveLength(0);
  await act(async () => {
    open();
  });
  expect(view.root.findAllByType(NativeSheet)).toHaveLength(1);
  await act(async () => {
    invoke(view.root.findByType(Modal), 'onRequestClose');
  });
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Device orders environment before diagnostics, preserving literal identifiers and missing versus false', async () => {
  mockBoard.reading = sensorSnapshotFixture();
  const reading = required(mockBoard.reading);
  reading.deviceSurface = {
    support: { status: 'available' },
    platform: 'Darwin_Test',
    systemName: 'Test_OS',
    systemMajorVersion: 27,
    interfaceIdiom: 'phone',
    bundleIdentifier: 'gov.Reference_App',
    simulator: false,
  };
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Device'), 'onPress');
  });
  const rows = () =>
    view.root.findAllByType(ValueRow).map((node) => [property(node, 'label'), property(node, 'value')]);
  const publish = async () => {
    await act(async () =>
      mockPublish({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' }),
    );
  };
  expect(rows()).toEqual([
    ['System', 'Test_OS'],
    ['Major version', '27'],
    ['Device type', 'iPhone'],
    ['Platform', 'Darwin_Test'],
    ['App ID', 'gov.Reference_App'],
    ['Simulator', 'No'],
    ['Status', 'Available'],
  ]);
  expect(JSON.stringify(view.toJSON())).toContain('included in sensor evidence saved on this phone');
  expect(JSON.stringify(view.toJSON())).toContain('do not independently verify device identity');
  expect(JSON.stringify(view.toJSON())).not.toContain('Nothing in this section is saved');
  reading.deviceSurface = {
    support: { status: 'available' },
    platform: 'iOS',
    systemName: 'iOS',
    simulator: true,
  };
  await publish();
  expect(rows()).toEqual([
    ['System', 'iOS'],
    ['Major version', '—'],
    ['Device type', '—'],
    ['Platform', 'iOS'],
    ['App ID', '—'],
    ['Simulator', 'Yes'],
    ['Status', 'Available'],
  ]);
  mockBoard.reading = null;
  await publish();
  expect(rows()).toEqual([]);
  expect(JSON.stringify(view.toJSON())).not.toContain('gov.Reference_App');
  expect(JSON.stringify(view.toJSON())).toContain('Waiting for a reading.');
  expect(button(view, 'API documentation')).toBeDefined();
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Magnetic field keeps usable strength, calibration and sample count distinct through replacement', async () => {
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Magnetic field'), 'onPress');
  });
  const rows = () =>
    view.root.findAllByType(ValueRow).map((node) => [property(node, 'label'), property(node, 'value')]);
  const publish = async () => {
    await act(async () =>
      mockPublish({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' }),
    );
  };
  expect(rows()).toEqual([]);
  mockBoard.reading = sensorSnapshotFixture();
  const reading = required(mockBoard.reading);
  reading.magnetometer = {
    support: { status: 'not_collected' },
    sampleCount: 0,
    calibrationAccuracy: 'uncalibrated',
  };
  await publish();
  expect(rows()).toEqual([
    ['Strength', '—'],
    ['Calibration', 'Not calibrated'],
    ['Samples', '0'],
    ['Status', 'Not read yet'],
  ]);
  expect(JSON.stringify(view.toJSON())).toContain('Calibration may be needed');
  reading.magnetometer = {
    support: { status: 'available' },
    sampleCount: 7,
    fieldMagnitudeMicrotesla: 42.5,
    calibrationAccuracy: 'high',
  };
  await publish();
  expect(rows()).toEqual([
    ['Strength', '42.5 µT'],
    ['Calibration', 'High'],
    ['Samples', '7'],
    ['Status', 'Available'],
  ]);
  reading.magnetometer = {
    support: { status: 'available' },
    sampleCount: 3,
    fieldMagnitudeMicrotesla: 25,
    calibrationAccuracy: 'raw',
  };
  await publish();
  expect(rows()).toEqual([
    ['Strength', '25 µT'],
    ['Calibration', 'Raw (no estimate)'],
    ['Samples', '3'],
    ['Status', 'Available'],
  ]);
  reading.magnetometer = { support: { status: 'not_supported_by_platform' }, sampleCount: 0 };
  await publish();
  expect(rows()).toEqual([
    ['Strength', '—'],
    ['Calibration', '—'],
    ['Samples', '0'],
    ['Status', 'Not on this device'],
  ]);
  expect(JSON.stringify(view.toJSON())).not.toContain('42.5');
  expect(JSON.stringify(view.toJSON())).toContain('last usable event, not a window average');
  expect(JSON.stringify(view.toJSON())).toContain('included in sensor evidence saved on this phone');
  expect(JSON.stringify(view.toJSON())).not.toContain('iOS 27.2');
  await act(async () => {
    invoke(button(view, t('sensors.docs.howWorkedOut', { title: 'Magnetic field' })), 'onPress');
  });
  expect(view.root.findAllByType(NativeSheet)).toHaveLength(1);
  expect(JSON.stringify(view.toJSON())).toContain('Uncalibrated device-motion events are excluded');
  expect(JSON.stringify(view.toJSON())).not.toContain('.swift');
  await act(async () => {
    invoke(view.root.findByType(Modal), 'onRequestClose');
  });
  expect(view.root.findAllByType(NativeSheet)).toHaveLength(0);
  mockBoard.reading = null;
  await publish();
  expect(rows()).toEqual([]);
  expect(button(view, 'API documentation')).toBeDefined();
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Motion preserves independent magnitudes and units, distinguishing zero, absent and unsupported readings', async () => {
  mockBoard.reading = sensorSnapshotFixture();
  const reading = required(mockBoard.reading);
  reading.motion = {
    support: { status: 'available' },
    sampleCount: 9,
    userAccelerationMagnitude: 0,
    rotationRateMagnitude: 2,
    gravityMagnitude: 1,
  };
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Motion'), 'onPress');
  });
  const rows = () =>
    view.root.findAllByType(ValueRow).map((node) => [property(node, 'label'), property(node, 'value')]);
  const publish = async () => {
    await act(async () =>
      mockPublish({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' }),
    );
  };
  expect(rows()).toEqual([
    ['Movement', '0 g'],
    ['Rotation', '2 rad/s'],
    ['Gravity', '1 g'],
    ['Samples', '9'],
    ['Status', 'Available'],
  ]);
  mockBoard.units = 'imperial';
  await publish();
  expect(rows().slice(0, 3)).toEqual([
    ['Movement', '0 g'],
    ['Rotation', '2 rad/s'],
    ['Gravity', '1 g'],
  ]);
  delete reading.motion.userAccelerationMagnitude;
  await publish();
  expect(rows()[0]).toEqual(['Movement', '—']);
  expect(rows()[1]).toEqual(['Rotation', '2 rad/s']);
  reading.motion = { support: { status: 'not_collected' }, sampleCount: 0 };
  await publish();
  expect(rows()).toEqual([
    ['Movement', '—'],
    ['Rotation', '—'],
    ['Gravity', '—'],
    ['Samples', '0'],
    ['Status', 'Not read yet'],
  ]);
  reading.motion = { support: { status: 'not_supported_by_platform' }, sampleCount: 0 };
  await publish();
  expect(rows()).toEqual([
    ['Movement', '—'],
    ['Rotation', '—'],
    ['Gravity', '—'],
    ['Samples', '0'],
    ['Status', 'Not on this device'],
  ]);
  const rendered = JSON.stringify(view.toJSON());
  expect(rendered).toContain('do not show direction or how the phone is oriented');
  expect(rendered).toContain('displayed magnitudes are not averages');
  expect(rendered).toContain('included in sensor evidence saved on this phone');
  expect(rendered).not.toContain('iOS 27.2');
  expect(rendered).not.toContain('Pick the phone up or turn it');
  await act(async () => {
    invoke(button(view, t('sensors.docs.howWorkedOut', { title: 'Motion' })), 'onPress');
  });
  expect(view.root.findAllByType(NativeSheet)).toHaveLength(1);
  expect(JSON.stringify(view.toJSON())).toContain('The result has no direction');
  expect(JSON.stringify(view.toJSON())).not.toContain('.swift');
  await act(async () => {
    invoke(view.root.findByType(Modal), 'onRequestClose');
  });
  expect(view.root.findAllByType(NativeSheet)).toHaveLength(0);
  mockBoard.reading = null;
  await publish();
  expect(rows()).toEqual([]);
  expect(button(view, 'API documentation')).toBeDefined();
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Mobile network separates reported generation, service and SIM observations from missing data', async () => {
  mockBoard.reading = sensorSnapshotFixture();
  const reading = required(mockBoard.reading);
  reading.telephony = {
    support: { status: 'available' },
    radioGenerations: ['5g', '4g'],
    radioVisibility: 'visible',
    serviceCount: 2,
    simInserted: false,
    cellularDataRestricted: 'restricted',
    dataServiceAvailable: true,
    dataServiceChangeCount: 7,
  };
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Mobile network'), 'onPress');
  });
  const rows = () =>
    view.root.findAllByType(ValueRow).map((node) => [property(node, 'label'), property(node, 'value')]);
  const publish = async () => {
    await act(async () =>
      mockPublish({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' }),
    );
  };
  expect(rows()).toEqual([
    ['Network type', '5G, 4G'],
    ['Radio information', 'Visible'],
    ['Mobile services', '2'],
    ['Mobile data', 'Restricted'],
    ['Data service visible', 'Yes'],
    ['Data service changes', '7'],
    ['Carrier SIM match', 'No'],
    ['Status', 'Available'],
  ]);
  reading.telephony = {
    support: { status: 'available' },
    radioGenerations: [],
    radioVisibility: 'hidden_by_ios',
    serviceCount: 0,
    cellularDataRestricted: 'not_restricted',
    dataServiceAvailable: false,
  };
  await publish();
  expect(rows()).toEqual([
    ['Network type', '—'],
    ['Radio information', 'Generation not reported'],
    ['Mobile services', '0'],
    ['Mobile data', 'Not restricted'],
    ['Data service visible', 'No'],
    ['Data service changes', '—'],
    ['Carrier SIM match', '—'],
    ['Status', 'Available'],
  ]);
  reading.telephony = {
    support: { status: 'available' },
    radioGenerations: ['future_radio'],
    cellularDataRestricted: 'unknown',
    dataServiceAvailable: true,
    dataServiceChangeCount: 0,
    simInserted: true,
  };
  await publish();
  expect(rows().slice(0, 7)).toEqual([
    ['Network type', 'future radio'],
    ['Radio information', '—'],
    ['Mobile services', '—'],
    ['Mobile data', 'Unknown'],
    ['Data service visible', 'Yes'],
    ['Data service changes', '0'],
    ['Carrier SIM match', 'Yes'],
  ]);
  reading.telephony = { support: { status: 'not_supported_by_platform' }, radioGenerations: [] };
  await publish();
  expect(rows()).toEqual([
    ['Network type', '—'],
    ['Radio information', '—'],
    ['Mobile services', '—'],
    ['Mobile data', '—'],
    ['Data service visible', '—'],
    ['Data service changes', '—'],
    ['Carrier SIM match', '—'],
    ['Status', 'Not on this device'],
  ]);
  expect(JSON.stringify(view.toJSON())).toContain(
    'raw service identifier and private code are not included in the reading',
  );
  expect(JSON.stringify(view.toJSON())).toContain('does not establish that cellular service is unavailable');
  expect(JSON.stringify(view.toJSON())).not.toContain('this app declares none');
  mockBoard.reading = null;
  await publish();
  expect(rows()).toEqual([]);
  expect(button(view, 'API documentation')).toBeDefined();
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Battery and heat retains independent thermal information when charge is missing', async () => {
  mockBoard.reading = sensorSnapshotFixture();
  const reading = required(mockBoard.reading);
  reading.battery = {
    support: { status: 'available' },
    level: 0,
    state: 'unplugged',
    lowPowerModeEnabled: false,
    thermalState: 'nominal',
  };
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Battery and heat'), 'onPress');
  });
  const rows = () =>
    view.root.findAllByType(ValueRow).map((node) => [property(node, 'label'), property(node, 'value')]);
  const publish = async () => {
    await act(async () =>
      mockPublish({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' }),
    );
  };
  expect(rows()).toEqual([
    ['Battery', '0 %'],
    ['Power', 'Not charging'],
    ['Low Power Mode', 'No'],
    ['Thermal state', 'Normal'],
    ['Status', 'Available'],
  ]);
  for (const [level, state, power] of [
    [0.5, 'charging', 'Charging'],
    [1, 'full', 'Full'],
  ] as const) {
    reading.battery.level = level;
    reading.battery.state = state;
    mockBoard.units = 'imperial';
    await publish();
    expect(rows()[0]).toEqual(['Battery', level === 1 ? '100 %' : '50 %']);
    expect(rows()[1]).toEqual(['Power', power]);
  }
  for (const [state, label] of [
    ['fair', 'Slightly elevated'],
    ['serious', 'High'],
    ['critical', 'Critical'],
    ['unknown', 'Unknown'],
  ] as const) {
    reading.battery.thermalState = state;
    await publish();
    expect(rows()[3]).toEqual(['Thermal state', label]);
  }
  reading.battery = { support: { status: 'available' }, thermalState: 'fair', lowPowerModeEnabled: true };
  await publish();
  expect(rows()).toEqual([
    ['Battery', '—'],
    ['Power', '—'],
    ['Low Power Mode', 'Yes'],
    ['Thermal state', 'Slightly elevated'],
    ['Status', 'Available'],
  ]);
  reading.battery.state = 'unknown';
  delete reading.battery.lowPowerModeEnabled;
  delete reading.battery.thermalState;
  await publish();
  expect(rows()).toEqual([
    ['Battery', '—'],
    ['Power', 'Unknown'],
    ['Low Power Mode', '—'],
    ['Thermal state', '—'],
    ['Status', 'Available'],
  ]);
  const rendered = JSON.stringify(view.toJSON());
  expect(rendered).toContain('not a temperature measurement or a measure of workload');
  expect(rendered).toContain('included in sensor evidence saved on this phone');
  expect(rendered).not.toContain('Nothing in this section is saved');
  mockBoard.reading = null;
  await publish();
  expect(rows()).toEqual([]);
  expect(button(view, 'API documentation')).toBeDefined();
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Barometer preserves accepted-sample semantics and selected pressure and height units', async () => {
  mockBoard.reading = sensorSnapshotFixture();
  const reading = required(mockBoard.reading);
  reading.barometer = { support: { status: 'available' }, sampleCount: 1, pressureKilopascals: 100 };
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Barometer'), 'onPress');
  });
  const rows = () =>
    view.root.findAllByType(ValueRow).map((node) => [property(node, 'label'), property(node, 'value')]);
  const publish = async () => {
    await act(async () =>
      mockPublish({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' }),
    );
  };
  expect(rows()).toEqual([
    ['Pressure', '1,000 hPa'],
    ['Relative height', '—'],
    ['Samples', '1'],
    ['Status', 'Available'],
  ]);
  reading.barometer.sampleCount = 2;
  reading.barometer.relativeAltitudeMeters = 0;
  await publish();
  expect(rows()[1]).toEqual(['Relative height', '0 m']);
  reading.barometer.relativeAltitudeMeters = 1;
  mockBoard.units = 'imperial';
  await publish();
  expect(rows().slice(0, 2)).toEqual([
    ['Pressure', '29.53 inHg'],
    ['Relative height', '3.281 ft'],
  ]);
  reading.barometer.relativeAltitudeMeters = -1;
  mockBoard.units = 'system';
  mockBoard.systemUsesImperial = true;
  await publish();
  expect(rows().slice(0, 2)).toEqual([
    ['Pressure', '29.53 inHg'],
    ['Relative height', '-3.281 ft'],
  ]);
  mockBoard.systemUsesImperial = false;
  await publish();
  expect(rows().slice(0, 2)).toEqual([
    ['Pressure', '1,000 hPa'],
    ['Relative height', '-1 m'],
  ]);
  reading.barometer = { support: { status: 'not_collected' }, sampleCount: 0 };
  for (const [permission, hint] of [
    ['notRequested', 'Turn on Motion & Fitness on the Settings tab.'],
    ['refused', 'Motion & Fitness is off. Turn it on in iOS Settings.'],
    ['given', 'No usable barometer reading was reported.'],
  ] as const) {
    mockBoard.permissions.motion = permission;
    await publish();
    expect(rows()).toEqual([
      ['Pressure', '—'],
      ['Relative height', '—'],
      ['Samples', '0'],
      ['Status', 'Not read yet'],
    ]);
    expect(JSON.stringify(view.toJSON())).toContain(hint);
  }
  for (const [status, label] of [
    ['unavailable', 'Unavailable'],
    ['not_supported_by_platform', 'Not on this device'],
  ] as const) {
    reading.barometer.support = { status };
    await publish();
    expect(rows().at(-1)).toEqual(['Status', label]);
  }
  expect(JSON.stringify(view.toJSON())).toContain(
    'One accepted event provides pressure but no measured height change',
  );
  expect(JSON.stringify(view.toJSON())).not.toContain('can tell a floor');
  expect(JSON.stringify(view.toJSON())).not.toContain('Nothing in this section is saved');
  await act(async () => {
    invoke(button(view, t('sensors.docs.howWorkedOut', { title: 'Barometer' })), 'onPress');
  });
  expect(JSON.stringify(view.toJSON())).toContain('Samples counts accepted events, not all events received');
  expect(JSON.stringify(view.toJSON())).not.toContain('.swift');
  await act(async () => {
    invoke(view.root.findByType(Modal), 'onRequestClose');
  });
  expect(view.root.findAllByType(NativeSheet)).toHaveLength(0);
  mockBoard.reading = null;
  await publish();
  expect(rows()).toEqual([]);
  expect(button(view, 'API documentation')).toBeDefined();
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

test('Bluetooth separates radio permission from audio routes without presenting scanning controls', async () => {
  mockBoard.reading = sensorSnapshotFixture();
  const reading = required(mockBoard.reading);
  reading.bluetooth = {
    support: { status: 'available' },
    authorization: 'denied',
    radioState: 'not_authorized',
    scanAvailable: false,
    audioRouteClass: 'car',
    audioRouteConnected: true,
    audioRouteChangeCount: 3,
  };
  const view = await render();
  await act(async () => {
    invoke(button(view, 'Bluetooth'), 'onPress');
  });
  const rows = () =>
    view.root.findAllByType(ValueRow).map((node) => [property(node, 'label'), property(node, 'value')]);
  const publish = async () => {
    await act(async () =>
      mockPublish({ board: mockBoard, busy: false, failure: null, sessionId: 'sensor-session' }),
    );
  };
  expect(rows()).toEqual([
    ['Bluetooth', 'Not allowed'],
    ['Permission', 'Denied'],
    ['Audio output type', 'Car'],
    ['Audio route present', 'Yes'],
    ['Audio route changes', '3'],
    ['Status', 'Available'],
  ]);
  reading.bluetooth = {
    support: { status: 'available' },
    authorization: 'allowed',
    radioState: 'powered_off',
    scanAvailable: false,
    audioRouteClass: 'none',
    audioRouteConnected: false,
    audioRouteChangeCount: 0,
  };
  await publish();
  expect(rows()).toEqual([
    ['Bluetooth', 'Off'],
    ['Permission', 'Allowed'],
    ['Audio output type', 'None'],
    ['Audio route present', 'No'],
    ['Audio route changes', '0'],
    ['Status', 'Available'],
  ]);
  for (const [state, label] of [
    ['powered_on', 'On'],
    ['resetting', 'Restarting'],
    ['unsupported', 'Not on this device'],
    ['unknown', 'Unknown'],
  ] as const) {
    reading.bluetooth.radioState = state;
    reading.bluetooth.support = { status: state === 'unsupported' ? 'unavailable' : 'available' };
    await publish();
    expect(rows()[0]).toEqual(['Bluetooth', label]);
    if (state === 'unsupported')
      expect(rows()).toEqual([
        ['Bluetooth', 'Not on this device'],
        ['Permission', 'Allowed'],
        ['Audio output type', 'None'],
        ['Audio route present', 'No'],
        ['Audio route changes', '0'],
        ['Status', 'Unavailable'],
      ]);
  }
  reading.bluetooth = {
    support: { status: 'available' },
    authorization: 'not_determined',
    radioState: 'not_authorized',
  };
  await publish();
  expect(rows()).toEqual([
    ['Bluetooth', 'Not allowed'],
    ['Permission', 'Not asked yet'],
    ['Audio output type', '—'],
    ['Audio route present', '—'],
    ['Audio route changes', '—'],
    ['Status', 'Available'],
  ]);
  reading.bluetooth = { support: { status: 'not_supported_by_platform' } };
  await publish();
  expect(rows()).toEqual([
    ['Bluetooth', '—'],
    ['Permission', '—'],
    ['Audio output type', '—'],
    ['Audio route present', '—'],
    ['Audio route changes', '—'],
    ['Status', 'Not on this device'],
  ]);
  expect(JSON.stringify(view.toJSON())).not.toContain('Can search');
  expect(JSON.stringify(view.toJSON())).toContain('does not search for or connect to devices');
  mockBoard.reading = null;
  await publish();
  expect(rows()).toEqual([]);
  expect(button(view, 'API documentation')).toBeDefined();
  expect(mockPerform).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});
