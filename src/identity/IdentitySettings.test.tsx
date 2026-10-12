import type { Configuration } from '@kenshiki/identity-capture';
import { IdentityCaptureSession } from '@kenshiki/identity-capture';
import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, mockSession, property, required } from '../testing/support';
import type { CompletedCapture } from './CaptureFlowController';
import type { SavedDocumentCapture } from './DocumentFlowController';
import { IdentitySettings } from './IdentitySettings';
import { t } from '../locales/i18n';
import { createControllerCustody } from '../ui/ControllerCustody';
import { ButtonRow, ListRow, ListSection } from '../ui/List';
import { useIdentityWorkspace } from '../app/useIdentityWorkspace';

jest.mock('../sensors/SensorScreen', () => ({
  SensorSettingsScreen: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@kenshiki/identity-capture', () => ({
  IdentitySymbol: 'MockSymbol',
  IdentityCaptureSession: { create: jest.fn() },
}));
const empty: Configuration = {};
const configured: Configuration = {
  results: { directoryURL: 'file:///saved', keychainService: 'saved', keychainAccount: 'saved' },
};
const session = mockSession({});
const passport: CompletedCapture = {
  session,
  passport: {
    documentNumber: 'DOCUMENT',
    birthDateYYMMDD: '900101',
    expiryDateYYMMDD: '310101',
    surname: 'EXAMPLE',
    givenNames: 'PERSON',
    nationality: 'UTO',
    issuingState: 'UTO',
    sex: 'X',
    portraitAvailable: false,
    portraitSHA256: null,
    personalNumber: null,
    dateOfIssue: null,
    issuingAuthority: null,
    placeOfBirth: null,
    correspondence: {},
    protocolVerdicts: { source: 'recorded', recordedAt: '2026-10-11T12:00:00Z' },
    protocols: {
      basicAccessControl: 'succeeded',
      pace: 'notPerformed',
      activeAuthentication: 'notPerformed',
      chipAuthentication: 'notPerformed',
      countrySigningChain: 'succeeded',
      documentSignature: 'succeeded',
      dataGroupHashes: 'succeeded',
    },
  },
};
const document: SavedDocumentCapture = {
  session,
  document: { workflowID: 'document', front: null, back: null },
};
const openSaved = jest.fn();
const startLicense = jest.fn();
const requestClear = jest.fn();
const onDeveloperChecks = jest.fn();
const home = jest.fn();
const navigate = jest.fn();
let custody = createControllerCustody();
type State = {
  result?: CompletedCapture;
  document?: SavedDocumentCapture;
  savedCount?: number;
  openingResults?: boolean;
  clearing?: boolean;
  restoreFailure?: string;
  clearFailure?: { target: 'passport' | 'document'; message: string };
};
function Harness({
  state = {},
  configuration = configured,
  developerChecks = false,
}: {
  state?: State;
  configuration?: Configuration;
  developerChecks?: boolean;
}) {
  const workspace = useIdentityWorkspace(empty, home, navigate, custody);
  return (
    <IdentitySettings
      configuration={configuration}
      developerChecks={developerChecks}
      onDeveloperChecks={onDeveloperChecks}
      workspace={{
        ...workspace,
        passport: {
          ...workspace.passport,
          result: state.result,
          savedCount: state.savedCount ?? 0,
          openingResults: state.openingResults ?? false,
          openSaved,
        },
        license: { ...workspace.license, result: state.document, start: startLicense },
        recovery: {
          ...workspace.recovery,
          requestClear,
          clearing: state.clearing ?? false,
          restoreFailure: state.restoreFailure,
          clearFailure: state.clearFailure,
        },
      }}
    />
  );
}
let view: ReactTestRenderer;
const developmentBuild = __DEV__;
beforeEach(() => {
  jest.clearAllMocks();
  custody = createControllerCustody();
});
afterEach(async () => {
  await act(async () => view?.unmount());
  Reflect.set(globalThis, '__DEV__', developmentBuild);
  jest.restoreAllMocks();
});
async function render(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => {
    view = create(<Harness {...props} />);
  });
}
const words = () => JSON.stringify(view.toJSON());

test('Known empty saved data has no capture or destructive actions and one explicit empty message', async () => {
  await render();
  expect(view.root.findAllByType(ListRow)).toHaveLength(0);
  expect(view.root.findAllByType(ButtonRow)).toHaveLength(0);
  expect(words()).toContain(t('settings.noSaved'));
  expect(openSaved).not.toHaveBeenCalled();
  expect(startLicense).not.toHaveBeenCalled();
  expect(requestClear).not.toHaveBeenCalled();
  expect(IdentityCaptureSession.create).not.toHaveBeenCalled();
});

test('Unsaved live passports are not offered as persisted results or erased through saved storage', async () => {
  await render({ configuration: empty, state: { result: passport, savedCount: 3 } });
  expect(view.root.findAllByType(ListRow)).toHaveLength(0);
  expect(view.root.findAllByType(ButtonRow)).toHaveLength(0);
  expect(session.release).not.toHaveBeenCalled();
  expect(session.eraseResults).not.toHaveBeenCalled();
});

test('Known saved passports remain available with no selected result', async () => {
  await render({ state: { savedCount: 2 } });
  const rows = view.root.findAllByType(ListRow);
  expect(rows.map((node) => property(node, 'rowID'))).toEqual(['settings-saved-passports']);
  expect(words()).not.toContain(t('settings.noSaved'));
  expect(view.root.findAllByType(ButtonRow)).toHaveLength(1);
  await act(async () => {
    invoke(required(rows[0]), 'onPress');
    invoke(required(view.root.findAllByType(ButtonRow)[0]), 'onPress');
  });
  expect(openSaved).toHaveBeenCalledTimes(1);
  expect(requestClear.mock.calls).toEqual([['passport']]);
  expect(session.eraseResults).not.toHaveBeenCalled();
});

test('License and Passport precede a separate destructive group; actions only request confirmation', async () => {
  await render({ state: { document, result: passport } });
  const rows = view.root.findAllByType(ListRow);
  expect(rows.map((node) => property(node, 'rowID'))).toEqual([
    'settings-license-checks',
    'settings-saved-passports',
  ]);
  const actions = view.root.findAllByType(ButtonRow);
  expect(actions.map((node) => property(node, 'label'))).toEqual([
    t('hub.action.deleteLicenseScans'),
    t('hub.action.eraseAll'),
  ]);
  const sections = view.root.findAllByType(ListSection);
  const navigation = required(sections.find((section) => section.findAllByType(ListRow).length > 0));
  const destructive = required(sections.find((section) => section.findAllByType(ButtonRow).length > 0));
  expect(navigation).not.toBe(destructive);
  expect(sections.indexOf(navigation)).toBeLessThan(sections.indexOf(destructive));
  expect(requestClear).not.toHaveBeenCalled();
  await act(async () => {
    for (const row of rows) invoke(row, 'onPress');
    for (const action of actions) {
      expect(property(action, 'destructive')).toBe(true);
      invoke(action, 'onPress');
    }
  });
  expect(startLicense.mock.calls).toEqual([[]]);
  expect(openSaved).toHaveBeenCalledTimes(1);
  expect(requestClear.mock.calls).toEqual([['document'], ['passport']]);
  expect(session.eraseDocuments).not.toHaveBeenCalled();
  expect(session.eraseResults).not.toHaveBeenCalled();
  expect(session.release).not.toHaveBeenCalled();
});

test.each<State>([
  { openingResults: true },
  { clearing: true },
  { restoreFailure: 'restore failed' },
  { clearFailure: { target: 'passport', message: 'erase failed' } },
])('Saved actions are disabled during pending or failed recovery %j', async (state) => {
  await render({ state: { ...state, document, result: passport } });
  for (const row of [...view.root.findAllByType(ListRow), ...view.root.findAllByType(ButtonRow)])
    expect(property(row, 'disabled')).toBe(true);
});

test.each<State>([{ openingResults: true }, { restoreFailure: 'restore failed' }])(
  'Unknown inventory never claims saved data is empty %j',
  async (state) => {
    await render({ state });
    expect(words()).not.toContain(t('settings.noSaved'));
  },
);

test('Developer route requires both the explicit option and a debug build', async () => {
  await render({ developerChecks: false });
  expect(view.root.findAllByType(ListRow)).toHaveLength(0);
  await act(async () => {
    view.update(<Harness developerChecks />);
  });
  const row = required(
    view.root.findAllByType(ListRow).find((node) => property(node, 'rowID') === 'open-sdk-checks'),
  );
  await act(async () => {
    invoke(row, 'onPress');
  });
  expect(onDeveloperChecks).toHaveBeenCalledTimes(1);
  Reflect.set(globalThis, '__DEV__', false);
  await act(async () => {
    view.update(<Harness developerChecks />);
  });
  expect(view.root.findAllByType(ListRow)).toHaveLength(0);
});
