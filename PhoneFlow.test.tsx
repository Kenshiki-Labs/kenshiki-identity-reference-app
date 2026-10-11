import type {
  CaptureEvent,
  PhoneCheckReceipt,
  PhoneCheckSnapshot,
  SubscriberComparisonResult,
} from '@kenshiki/identity-capture';
import { IdentityCaptureSession } from '@kenshiki/identity-capture';
import type { AppStateStatus } from 'react-native';
import { AppState } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { documentConfiguration, documentSessionMethods } from './__tests__/documentFixture';
import { phoneConfiguration } from './__tests__/phoneFixture';
import { actionSheets, invoke, required, settle, without } from './__tests__/support';
import App from './App';
import { PhoneResultDetails } from './PhoneFlow';

const mockReady: PhoneCheckSnapshot = {
  stage: 'start',
  busy: false,
  failure: null,
  pending: false,
  sent: false,
  challengeReserved: false,
  receipt: null,
  recordedAt: null,
  sendAgainAt: null,
};
const mockReceipt: PhoneCheckReceipt = {
  challengeID: 'synthetic',
  sender: '12025550123',
  messageHash: 'a'.repeat(64),
  receivedAt: '2026-10-08T12:00:00Z',
  completedAt: '2026-10-08T12:00:01Z',
  subjectComparison: {
    status: 'agreed',
    fieldsCompared: ['givenName'],
    checkedAt: '2026-10-08T12:00:01Z',
    evidence: {
      requestID: 'synthetic',
      providers: [
        {
          source: 'synthetic-source-a',
          answered: true,
          carrier: 'Synthetic carrier',
          smsFraudRiskScore: 0,
          numberValid: false,
        },
        { source: 'synthetic-source-b', answered: false, failure: 'timed_out' },
      ],
      fields: [
        { field: 'givenName', source: 'synthetic-source-a', grade: 'no_match' },
        { field: 'extra', source: 'synthetic-source-c', grade: 'future' },
      ],
    },
  },
  subscriberFailure: null,
};
let mockSnapshot = mockReady;
let mockListener: ((event: CaptureEvent) => void) | undefined;
const mockSession = {
  subscribe: jest.fn((listener: (event: CaptureEvent) => void) => {
    mockListener = listener;
    return () => {
      mockListener = undefined;
    };
  }),
  phoneSnapshot: jest.fn(async () => mockSnapshot),
  phoneCancel: jest.fn(async () => mockSnapshot),
  phoneSend: jest.fn(async () => {
    mockSnapshot = { ...mockReady, stage: 'waiting', pending: true, sent: true, challengeReserved: true };
    return mockSnapshot;
  }),
  phoneResume: jest.fn(async () => mockSnapshot),
  phoneRetrySave: jest.fn(async () => mockSnapshot),
  phoneStartOver: jest.fn(async () => mockSnapshot),
  phoneErase: jest.fn(async () => {}),
  release: jest.fn(async () => {}),
};
const mockDocumentSession = {
  ...documentSessionMethods(),
  id: 'synthetic-document-session',
  subscribe: jest.fn(() => () => {}),
  cancel: jest.fn(async () => {}),
  release: jest.fn(async () => {}),
};
let mockDocumentSessionPending = true;
jest.mock('@kenshiki/identity-capture', () => ({
  documentFieldReadout: jest.requireActual<
    typeof import('../../ReactNative/identity-capture/src/DocumentReadout')
  >('../../ReactNative/identity-capture/src/DocumentReadout').documentFieldReadout,
  isCaptureErrorCode: jest.requireActual<typeof import('../../ReactNative/identity-capture/src/codes')>(
    '../../ReactNative/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCaptureSession: {
    create: jest.fn(async () => {
      if (mockDocumentSessionPending) {
        mockDocumentSessionPending = false;
        return mockDocumentSession;
      }
      return mockSession;
    }),
  },
  IdentityCapturePreview: 'MockCapturePreview',
  IdentityCaptureImage: 'MockCaptureImage',
  IdentityDocumentInspection: 'MockDocumentInspection',
  IdentitySymbol: 'MockSymbol',
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockSnapshot = mockReady;
  mockDocumentSessionPending = true;
  mockListener = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(() => jest.restoreAllMocks());
async function renderApp() {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(
      <App configuration={{ phone: phoneConfiguration, document: documentConfiguration }} />,
    );
  });
  async function tap(id: string) {
    await act(async () => {
      const button = required(
        view.root
          .findAllByProps({ testID: id })
          .filter((node) => typeof node.props.onPress === 'function')
          .at(-1),
      );
      await invoke(button, 'onPress');
    });
  }
  await tap('open-driver-license');
  await tap('finish-document');
  return { view, tap };
}
test('Phone opens from Identity, sending waits for receipt, Done and reopen keep all findings', async () => {
  const { view, tap } = await renderApp();
  await tap('open-phone');
  expect(jest.mocked(IdentityCaptureSession.create).mock.calls.at(-1)?.[0]?.phone?.checkedDocumentID).toBe(
    'synthetic-front',
  );
  expect(mockDocumentSession.release).not.toHaveBeenCalled();
  expect(mockSession.phoneSend).not.toHaveBeenCalled();
  await tap('phone-send');
  expect(JSON.stringify(view.toJSON())).toContain('Waiting for your text');
  expect(view.root.findAllByProps({ testID: 'phone-result' })).toHaveLength(0);
  await act(async () => {
    mockSnapshot = { ...mockReady, stage: 'completed', receipt: mockReceipt };
    mockListener?.({ type: 'phoneSnapshot', snapshot: mockSnapshot });
  });
  let shown = JSON.stringify(view.toJSON());
  for (const value of [
    '12025550123',
    'Subscriber details agree',
    'Synthetic carrier',
    'Does not match',
    'Unrecognized result',
    'Message fraud risk score',
    'Number valid',
    'Reported a failure',
  ])
    expect(shown).toContain(value);
  expect(shown).not.toContain('Subscriber details differ');
  expect(shown).not.toContain('synthetic-source');
  await tap('phone-receipt-details');
  expect(JSON.stringify(view.toJSON())).toContain('a'.repeat(64));
  await tap('phone-done');
  await tap('open-phone');
  shown = JSON.stringify(view.toJSON());
  expect(shown).toContain('Synthetic carrier');
  expect(mockSession.phoneSend).toHaveBeenCalledTimes(1);
  expect(mockSession.release).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
  expect(mockSession.release).toHaveBeenCalledTimes(1);
});
test('a new check requires an action-sheet confirmation', async () => {
  mockSnapshot = { ...mockReady, stage: 'completed', receipt: mockReceipt };
  const sheets = actionSheets();
  const { view, tap } = await renderApp();
  await tap('open-phone');
  await tap('phone-new');
  expect(sheets.last().options).toEqual(['Start new check', 'Keep current check']);
  expect(mockSession.phoneStartOver).not.toHaveBeenCalled();
  await act(async () => {
    sheets.last().choose(0);
    await settle();
  });
  expect(mockSession.phoneStartOver).toHaveBeenCalledWith(true);
  await act(async () => {
    view.unmount();
  });
});
test('inactive message-composer transitions do not cancel; actual backgrounding pauses', async () => {
  let change: ((state: AppStateStatus) => void) | undefined;
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_kind, listener) => {
    change = listener;
    return { remove: jest.fn() };
  });
  const { view, tap } = await renderApp();
  await tap('open-phone');
  await act(async () => {
    change?.('inactive');
  });
  expect(mockSession.phoneCancel).not.toHaveBeenCalled();
  await act(async () => {
    change?.('background');
  });
  expect(mockSession.phoneCancel).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.unmount();
  });
  spy.mockRestore();
});
test('older receipts explicitly explain missing details without triggering a new check', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<PhoneResultDetails receipt={without(mockReceipt, 'subjectComparison')} />);
  });
  expect(JSON.stringify(view.toJSON())).toContain(
    'Number check details are not present in this saved receipt',
  );
  expect(mockSession.phoneSend).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});

test('subscriber findings appear on the same result screen without another consent or send step', async () => {
  const subscriber: SubscriberComparisonResult = {
    operationID: 'synthetic-comparison',
    profileVersion: 'synthetic',
    subjectRevision: 'synthetic',
    numberVerificationReference: mockReceipt.challengeID,
    completedAt: mockReceipt.completedAt,
    provider: {
      providerID: 'Synthetic provider',
      product: 'Synthetic comparison',
      apiVersion: 'v1',
      adapterVersion: 'v1',
      reviewRevision: 'not-live',
    },
    checks: [
      {
        name: 'givenName',
        submitted: true,
        compared: true,
        outcome: 'noMatch',
        scope: 'individualAttribute',
        coveredInputs: ['givenName'],
        reason: 'reportedGrade',
      },
      {
        name: 'birthDate',
        submitted: true,
        compared: null,
        outcome: 'noData',
        scope: 'unqualified',
        coveredInputs: [],
        reason: 'noData',
      },
    ],
    evaluation: {
      status: 'incomplete',
      policyVersion: 'test-only',
      requiredChecks: ['givenName', 'birthDate'],
      gradePolicy: {
        givenName: ['exactMatch'],
        familyName: ['exactMatch'],
        birthDate: ['exactMatch'],
        addressLines: ['exactMatch'],
        city: ['exactMatch'],
        region: ['exactMatch'],
        postalCode: ['exactMatch'],
        country: ['exactMatch'],
      },
      outsidePolicyChecks: ['givenName'],
      incompleteChecks: ['birthDate'],
      sourceFreshness: 'unknownTimeAllowed',
    },
    source: { kind: 'unknown' },
    wholeAddress: {
      submitted: true,
      compared: true,
      outcome: 'exactMatch',
      coveredInputs: [],
      reason: 'reportedGrade',
      coverageBasis: 'unverified',
    },
  };
  const { view, tap } = await renderApp();
  await tap('open-phone');
  await tap('phone-send');
  await act(async () => {
    mockSnapshot = {
      ...mockReady,
      stage: 'completed',
      receipt: { ...without(mockReceipt, 'subjectComparison'), subscriberComparison: subscriber },
    };
    mockListener?.({ type: 'phoneSnapshot', snapshot: mockSnapshot });
  });
  const shown = JSON.stringify(view.toJSON());
  for (const text of [
    'Phone possession confirmed',
    'Comparison incomplete',
    'Does not match',
    'No data',
    'Not returned',
    'Whole address',
    'This combined observation does not fill in missing individual address checks.',
  ])
    expect(shown).toContain(text);
  expect(shown).not.toContain('Required details agree');
  expect(shown).not.toContain('Synthetic provider');
  expect(view.root.findAllByProps({ testID: 'phone-bottom-sheet' })).toHaveLength(0);
  await tap('phone-done');
  await tap('open-phone');
  expect(JSON.stringify(view.toJSON())).toContain('Comparison incomplete');
  expect(mockSession.phoneSend).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.unmount();
  });
});

test.each(['outcomeUnknown', 'capabilityUnavailable'] as const)(
  'subscriber %s preserves possession without automatic retry',
  async (failure) => {
    mockSnapshot = {
      ...mockReady,
      stage: 'completed',
      receipt: { ...without(mockReceipt, 'subjectComparison'), subscriberFailure: failure },
    };
    const { view, tap } = await renderApp();
    await tap('open-phone');
    const shown = JSON.stringify(view.toJSON());
    expect(shown).toContain('Phone possession confirmed');
    expect(shown).toContain(failure === 'outcomeUnknown' ? 'may have run' : 'was not run');
    expect(shown).not.toContain('Subscriber details agree');
    expect(mockSession.phoneSend).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
  },
);
