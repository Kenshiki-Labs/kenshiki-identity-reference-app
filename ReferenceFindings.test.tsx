import type {
  Configuration,
  DocumentCheckSnapshot,
  DocumentObservation,
  FaceComparison,
  PassportObservation,
  PhoneCheckReceipt,
  PhoneCheckSnapshot,
  SSNSessionSnapshot,
  SubscriberComparisonFailure,
  SubscriberComparisonResult,
} from '@kenshiki/identity-capture';
import type React from 'react';
import { AppState, StyleSheet } from 'react-native';
import renderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { documentConfiguration, documentSessionMethods } from './__tests__/documentFixture';
import { phoneConfiguration } from './__tests__/phoneFixture';
import { ssnReceipt } from './__tests__/ssnFixture';
import {
  actionSheets,
  invoke,
  mockSession as makeSession,
  required,
  settle,
  without,
} from './__tests__/support';
import App from './App';
import { CaptureFlowController } from './CaptureFlowController';
import { DocumentCheckPanel } from './DocumentCheckPanel';
import { DocumentFlowController } from './DocumentFlowController';
import { DocumentResultDetails } from './DocumentResultDetails';
import { CaptureResultDetails } from './IdentityCaptureFlow';
import { PhoneResultDetails } from './PhoneFlow';
import { SSNResultDetails } from './SSNFlow';
import { SubscriberResultDetails } from './SubscriberResultDetails';
import { styles } from './ui/styles';

// Reference-app findings of the 8 October 2026 fix brief (Fix B). Mock tier: jest with mocked sessions.

let mockSession = makeSession({});
jest.mock('@kenshiki/identity-capture', () => ({
  documentFieldReadout: jest.requireActual<
    typeof import('../../ReactNative/identity-capture/src/DocumentReadout')
  >('../../ReactNative/identity-capture/src/DocumentReadout').documentFieldReadout,
  isCaptureErrorCode: jest.requireActual<typeof import('../../ReactNative/identity-capture/src/codes')>(
    '../../ReactNative/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCaptureSession: { create: jest.fn(async () => mockSession) },
  IdentityCapturePreview: 'MockCapturePreview',
  IdentityCaptureImage: 'MockCaptureImage',
  IdentityDocumentInspection: 'MockDocumentInspection',
  IdentitySymbol: 'MockSymbol',
}));

const passport: PassportObservation = {
  documentNumber: 'X1234567',
  birthDateYYMMDD: '850615',
  expiryDateYYMMDD: '320101',
  surname: 'SPECIMEN',
  givenNames: 'SYNTHETIC',
  nationality: 'UTO',
  issuingState: 'UTO',
  sex: 'F',
  portraitAvailable: true,
  portraitSHA256: 'reference',
  personalNumber: null,
  dateOfIssue: null,
  issuingAuthority: null,
  placeOfBirth: null,
  correspondence: { documentNumber: 'matches' },
  protocols: {
    basicAccessControl: 'succeeded',
    pace: 'notPerformed',
    activeAuthentication: 'notPerformed',
    chipAuthentication: 'notPerformed',
    countrySigningChain: 'succeeded',
    documentSignature: 'succeeded',
    dataGroupHashes: 'succeeded',
  },
  savedResult: {
    id: 'p',
    workflowID: 'w',
    kind: 'passport-read-v1',
    revision: 1,
    recordedAt: '2026-10-08T12:00:00Z',
    artifacts: [],
  },
  protocolVerdicts: { source: 'recorded', recordedAt: '2026-10-08T12:00:00Z' },
};
const depth = {
  schemaVersion: 1,
  imageTimestamp: 1,
  depthTimestamp: 1,
  orientation: 1,
  mapWidth: 32,
  mapHeight: 32,
  imageSHA256: 'selfie',
  filtered: false,
  ageAtAdmission: 0.01,
  measurement: {
    sampleCount: 255,
    residualRMS: 0.019,
    policy: {
      identifier: 'policy',
      minimumResidualRMS: 0.004,
      minimumSamples: 64,
      maximumDepthAge: 0.25,
      nearLimit: 0.15,
      farLimit: 1.2,
      samplesPerAxis: 16,
    },
  },
};
const comparison: FaceComparison = {
  similarity: 0.55,
  outcome: 'pass',
  implementationVersion: 'test',
  referenceSHA256: 'reference',
  selfieSHA256: 'selfie',
  route: 'scrfd',
  modelLoadingSeconds: 0,
  comparisonSeconds: 1,
  admissionReceipt: {
    policyVersion: 'test',
    frameTimestamp: 1,
    anchorID: 'synthetic-anchor',
    blinkCompletedAt: 1,
    leftEyeClosed: 0,
    rightEyeClosed: 0,
    captureQualityEnforced: false,
    guideContainmentEnforced: false,
    trigger: 'automatic',
    eyesOpen: true,
    blinkAge: 0,
    consecutiveTrackedFrames: 10,
    steadyHoldDuration: 1,
    depthEvidence: depth,
  },
  savedResult: {
    id: 'f',
    workflowID: 'w',
    kind: 'face-comparison-v1',
    revision: 1,
    recordedAt: '2026-10-08T12:05:00Z',
    artifacts: [],
  },
};
const phoneReady: PhoneCheckSnapshot = {
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
const phoneReceipt: PhoneCheckReceipt = {
  challengeID: 'synthetic',
  sender: '12025550123',
  messageHash: 'a'.repeat(64),
  receivedAt: '2026-10-08T12:00:00Z',
  completedAt: '2026-10-08T12:00:01Z',
  subscriberFailure: null,
};
const subscriber: SubscriberComparisonResult = {
  operationID: 'comparison',
  profileVersion: 'profile',
  subjectRevision: 'subject',
  numberVerificationReference: 'synthetic',
  completedAt: '2026-10-08T12:00:02Z',
  provider: {
    providerID: 'synthetic-provider-id',
    product: 'synthetic-product',
    apiVersion: 'v1',
    adapterVersion: 'v1',
    reviewRevision: 'r',
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
  ],
  evaluation: {
    status: 'notSatisfied',
    policyVersion: 'policy',
    requiredChecks: ['givenName'],
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
    incompleteChecks: [],
    sourceFreshness: 'unknownTimeAllowed',
  },
  source: { kind: 'operator', observedAt: '2026-10-08T11:00:00Z' },
};
const ssnReady: SSNSessionSnapshot = {
  state: 'ready',
  entryDigits: '',
  confirmation: null,
  attempt: null,
  receipt: null,
  failure: null,
  recoveryNeeded: false,
  busy: false,
};
let phoneSnapshot = phoneReady;

beforeEach(() => {
  jest.clearAllMocks();
  phoneSnapshot = phoneReady;
  mockSession = makeSession({
    subscribe: jest.fn(() => jest.fn()),
    release: jest.fn(async () => {}),
    cancel: jest.fn(async () => {}),
    listResults: jest.fn(async () => []),
    eraseResults: jest.fn(async () => {}),
    recoverPassport: jest.fn(async () => passport),
    recoverFace: jest.fn(async () => comparison),
    phoneSnapshot: jest.fn(async () => phoneSnapshot),
    phoneCancel: jest.fn(async () => phoneSnapshot),
    phoneStartOver: jest.fn(async () => ({ ...phoneReady, pending: true })),
    phoneErase: jest.fn(async () => {}),
    ssnSnapshot: jest.fn(async () => ssnReady),
    ssnCancel: jest.fn(async () => ssnReady),
    ssnErase: jest.fn(async () => {}),
    listDocuments: jest.fn(async () => []),
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(() => jest.restoreAllMocks());

async function render(element: React.ReactElement) {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(element);
  });
  const tap = async (id: string) =>
    act(async () => {
      const button = view.root
        .findAllByProps({ testID: id })
        .filter((node) => typeof node.props.onPress === 'function')
        .at(-1);
      if (!button) throw new Error(`Missing ${id}`);
      await invoke(button, 'onPress');
    });
  const press = async (label: string) =>
    act(async () => {
      const button = view.root
        .findAll((node) => node.props.label === label && typeof node.props.onPress === 'function')
        .at(-1);
      if (!button) throw new Error(`Missing ${label}`);
      await invoke(button, 'onPress');
    });
  const text = () => JSON.stringify(view.toJSON());
  return { view, tap, press, text };
}
const selectable = (root: ReactTestInstance) => root.findAll((node) => node.props.selectable === true);

describe('1 developer checks', () => {
  test('a normal launch has no Developer checks entry; only the simulator debug host passes it in', async () => {
    const plain = await render(<App configuration={{ phone: phoneConfiguration }} />);
    expect(plain.view.root.findAllByProps({ testID: 'open-sdk-checks' })).toHaveLength(0);
    await act(async () => {
      plain.view.unmount();
    });
    const developer = await render(<App developerChecks />);
    expect(developer.view.root.findAllByProps({ testID: 'open-sdk-checks' }).length).toBeGreaterThan(0);
    await act(async () => {
      developer.view.unmount();
    });
  });
});

async function openDocumentBoundPhone() {
  Object.assign(mockSession, documentSessionMethods());
  const f = await render(
    <App configuration={{ phone: phoneConfiguration, document: documentConfiguration }} />,
  );
  await f.tap('open-driver-license');
  await f.tap('finish-document');
  await f.tap('open-phone');
  return f;
}

describe('2 contradicted carrier verdict stops', () => {
  test.each([
    [
      'carrier comparison contradicted',
      {
        ...phoneReceipt,
        subjectComparison: {
          status: 'contradicted' as const,
          fieldsCompared: ['givenName'],
          checkedAt: '2026-10-08T12:00:01Z',
        },
      },
    ],
    ['subscriber comparison not satisfied', { ...phoneReceipt, subscriberComparison: subscriber }],
  ])('%s stops with a retry instead of confirming possession and offering Done', async (_name, receipt) => {
    phoneSnapshot = { ...phoneReady, stage: 'completed', receipt };
    const sheets = actionSheets();
    const f = await openDocumentBoundPhone();
    expect(f.text()).not.toContain('Phone possession confirmed');
    expect(f.view.root.findAllByProps({ testID: 'phone-done' })).toHaveLength(0);
    expect(f.view.root.findAllByProps({ testID: 'phone-stopped' }).length).toBeGreaterThan(0);
    await f.tap('phone-retry');
    expect(sheets.last().title).toBe('Start a new phone check?');
    expect(mockSession.phoneStartOver).not.toHaveBeenCalled();
    await act(async () => {
      sheets.last().choose(0);
      await settle();
    });
    expect(mockSession.phoneStartOver).toHaveBeenCalledWith(true);
    await act(async () => {
      f.view.unmount();
    });
  });
  test('the Identity card does not report a stopped check as an available result', async () => {
    phoneSnapshot = {
      ...phoneReady,
      stage: 'completed',
      receipt: {
        ...phoneReceipt,
        subjectComparison: {
          status: 'contradicted',
          fieldsCompared: ['givenName'],
          checkedAt: '2026-10-08T12:00:01Z',
        },
      },
    };
    const f = await openDocumentBoundPhone();
    await f.tap('modal-cancel');
    expect(f.text()).toContain('Check stopped');
    expect(f.text()).not.toContain('Result available');
    await act(async () => {
      f.view.unmount();
    });
  });
});

describe('3 providers are described by function', () => {
  test('provider names, sources and identifiers are not rendered and no row depends on a vendor name', async () => {
    const receipt: PhoneCheckReceipt = {
      ...phoneReceipt,
      subjectComparison: {
        status: 'agreed',
        fieldsCompared: ['givenName'],
        checkedAt: '2026-10-08T12:00:01Z',
        evidence: {
          requestID: 'request',
          providers: [
            { source: 'synthetic-source-label', answered: true, smsFraudRiskScore: 3, formatValid: true },
          ],
          fields: [{ field: 'givenName', source: 'synthetic-source-label', grade: 'match' }],
        },
      },
    };
    const f = await render(<PhoneResultDetails key="phone" receipt={receipt} />);
    expect(f.text()).not.toContain('synthetic-source-label');
    expect(f.text()).toContain('3');
    expect(f.text()).not.toContain('Risk advisor score');
    await act(async () => {
      f.view.unmount();
    });
    const s = await render(<SubscriberResultDetails result={subscriber} />);
    expect(s.text()).not.toContain('synthetic-provider-id');
    expect(s.text()).not.toContain('synthetic-product');
    await act(async () => {
      s.view.unmount();
    });
  });
});

describe('4 typed error handling', () => {
  test('a failed erase names its cause instead of one generic sentence', async () => {
    const durable: Configuration = {
      results: { directoryURL: 'file:///r', keychainService: 's', keychainAccount: 'a' },
    };
    mockSession.listResults.mockResolvedValue([
      {
        id: 'saved',
        revision: 1,
        recordedAt: '2026-10-08T12:00:00Z',
        kind: 'passport-read-v1',
        workflowID: 'saved',
        artifacts: [],
      },
    ]);
    mockSession.eraseResults.mockRejectedValueOnce({ code: 'busy' });
    const sheets = actionSheets();
    const f = await render(<App configuration={durable} />);
    await f.tap('open-capture-flow');
    await f.press('Clear results');
    expect(sheets.last().options[0]).toBe('Clear results');
    await act(async () => {
      sheets.last().choose(0);
      await settle();
    });
    expect(f.text()).toContain('Another check is still finishing');
    await act(async () => {
      f.view.unmount();
    });
  });
  test('the document check panel renders snapshot.failure and command failures by code', async () => {
    const unavailable: DocumentCheckSnapshot = {
      captureID: 'c',
      sourceSHA256: 's',
      state: 'unavailable',
      result: null,
      checkedAt: null,
      failure: 'serviceUnavailable',
    };
    const session = makeSession({
      documentCheckRestore: jest.fn(async () => unavailable),
      documentCheck: jest.fn(async () => {
        throw { code: 'consentRequired' };
      }),
      cancel: jest.fn(async () => {}),
    });
    const f = await render(<DocumentCheckPanel session={session} configured />);
    expect(f.text()).toContain('The checking service did not answer');
    await act(async () => {
      f.view.update(
        <DocumentCheckPanel
          session={makeSession({
            ...session,
            documentCheckRestore: jest.fn(
              async (): Promise<DocumentCheckSnapshot> => ({
                ...unavailable,
                state: 'notStarted',
                failure: null,
              }),
            ),
          })}
          configured
        />,
      );
    });
    await f.press('Check record');
    expect(f.text()).toContain('Agree to the record check');
    await act(async () => {
      f.view.unmount();
    });
  });
  test('camera restricted and camera unavailable are different document messages', async () => {
    const start = jest.fn();
    const make = (code: string) => {
      const session = {
        subscribe: jest.fn(() => jest.fn()),
        startDocument: jest.fn(async () => {
          throw { code };
        }),
        listDocuments: jest.fn(async () => []),
        cancel: jest.fn(async () => {}),
        release: jest.fn(async () => {}),
        documentResult: start,
      };
      return new DocumentFlowController(async () => makeSession(session), {}, jest.fn());
    };
    const restricted = make('cameraPermissionRestricted');
    await restricted.startFront();
    const unavailable = make('backCameraUnavailable');
    await unavailable.startFront();
    expect(restricted.state.sheet?.title).not.toBe(unavailable.state.sheet?.title);
    expect(restricted.state.sheet?.message).toContain('restricted');
  });
  test('PDF417 notFound, ambiguous and failed and AAMVA malformed and unsupported each get their own text', async () => {
    const front = {
      captureID: 'f',
      sha256: 'f',
      side: 'front' as const,
      pdf417: null,
      pdf417Status: 'notRequested' as const,
      sideCorrespondence: null,
    };
    const back = (
      pdf417Status: 'notFound' | 'ambiguous' | 'failed' | 'readable',
      status?: 'malformed' | 'unsupported',
    ): DocumentObservation => ({
      workflowID: 'w',
      front,
      back: {
        captureID: 'b',
        sha256: 'b',
        side: 'back',
        pdf417Status,
        sideCorrespondence: null,
        pdf417: status
          ? {
              status,
              fields: {},
              version: null,
              issuerIIN: null,
              jurisdictionVersion: null,
              missingRequiredElements: [],
            }
          : null,
      },
    });
    const shown: string[] = [];
    for (const document of [
      back('notFound'),
      back('ambiguous'),
      back('failed'),
      back('readable', 'malformed'),
      back('readable', 'unsupported'),
    ]) {
      const f = await render(
        <DocumentResultDetails result={{ session: makeSession(mockSession), document }} />,
      );
      const children: unknown = f.view.root.findByProps({ testID: 'document-barcode-status' }).props.children;
      if (typeof children !== 'string') throw new Error('Expected barcode status text');
      shown.push(children);
      await act(async () => {
        f.view.unmount();
      });
    }
    expect(new Set(shown).size).toBe(5);
  });
  test('every subscriber failure has its own text', async () => {
    const failures: SubscriberComparisonFailure[] = [
      'busy',
      'consentRequired',
      'invalidRequest',
      'contextChanged',
      'storageUnavailable',
      'outcomeUnknown',
      'invalidResponse',
      'notConfigured',
      'unauthorized',
      'forbidden',
      'profileChanged',
      'expiredRequest',
      'invalidEvidence',
      'rateLimited',
      'capabilityUnavailable',
    ];
    const shown = new Set<string>();
    for (const failure of failures) {
      const f = await render(<SubscriberResultDetails failure={failure} />);
      shown.add(f.text());
      await act(async () => {
        f.view.unmount();
      });
    }
    expect(shown.size).toBe(failures.length);
  });
});

describe('5 what the holder sees', () => {
  test('document check results preserve unknown provider evidence and translate correction prompts', async () => {
    const checked: DocumentCheckSnapshot = {
      captureID: 'c',
      sourceSHA256: 's',
      state: 'checked',
      checkedAt: '2026-10-08T12:00:00Z',
      failure: null,
      result: {
        outcome: 'needsCorrection',
        operationID: 'op',
        providerStatus: 'raw-provider-status',
        replayed: false,
        providerChecks: [
          {
            name: 'raw_check_name',
            status: 'raw_status',
            reasons: ['raw_reason'],
            metadataJSON: JSON.stringify({ 'raw-meta-key': 'x' }),
          },
        ],
        submittedFields: { givenName: 'SYNTHETIC' },
        correctable: [{ field: 'givenName', code: 'raw_correction_code' }],
      },
    };
    const session = makeSession({
      documentCheckRestore: jest.fn(async () => checked),
      cancel: jest.fn(async () => {}),
    });
    const f = await render(<DocumentCheckPanel session={session} configured />);
    await f.press('Review requested corrections');
    for (const evidence of ['raw_check_name', 'raw_status', 'raw_reason', 'raw-meta-key']) {
      expect(f.text()).toContain(evidence);
    }
    for (const raw of ['raw-provider-status', 'raw_correction_code', '"givenName"', '2026-10-08T12:00:00Z']) {
      expect(f.text()).not.toContain(raw);
    }
    expect(f.text()).toContain('Given name');
    expect(f.text()).toContain('SYNTHETIC');
    await act(async () => {
      f.view.unmount();
    });
  });
  test('passport, face, SSN, phone and saved-list timestamps are formatted for a person', async () => {
    const shown: string[] = [];
    const p = await render(
      <CaptureResultDetails
        key="capture"
        result={{ session: makeSession(mockSession), passport, comparison }}
        focus="face"
      />,
    );
    shown.push(p.text());
    await act(async () => {
      p.view.unmount();
    });
    const s = await render(
      <SSNResultDetails
        key="ssn"
        receipt={{
          ...ssnReceipt,
          operationID: 'o',
          checkedAt: '2026-10-08T12:00:00Z',
          issuance: 'notIssued',
        }}
      />,
    );
    shown.push(s.text());
    await act(async () => {
      s.view.unmount();
    });
    const ph = await render(<PhoneResultDetails key="phone" receipt={phoneReceipt} />);
    shown.push(ph.text());
    await act(async () => {
      ph.view.unmount();
    });
    for (const value of shown) {
      expect(value).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      expect(value).toContain('Oct 8, 2026');
    }
    mockSession.listResults.mockResolvedValue([
      {
        id: 'first',
        revision: 1,
        recordedAt: '2026-10-08T12:00:00Z',
        kind: 'passport-read-v1',
        workflowID: 'first',
        artifacts: [],
      },
      {
        id: 'second',
        revision: 1,
        recordedAt: '2026-10-08T12:00:00Z',
        kind: 'passport-read-v1',
        workflowID: 'second',
        artifacts: [],
      },
    ]);
    const list = await render(
      <App
        configuration={{
          trustAnchorsURL: 'file:///anchors.pem',
          results: { directoryURL: 'file:///r', keychainService: 's', keychainAccount: 'a' },
        }}
      />,
    );
    await list.tap('open-capture-flow');
    expect(list.text()).not.toContain('2026-10-08T12:00:00Z');
    expect(list.text()).toContain('Oct 8, 2026');
    await act(async () => {
      list.view.unmount();
    });
  });
  test('configuration failures say what the holder can do, never contact an unnamed support', async () => {
    const session = {
      subscribe: jest.fn(() => jest.fn()),
      cancel: jest.fn(async () => {}),
      release: jest.fn(async () => {}),
      startMRZ: jest.fn(async () => {}),
      captureMRZ: jest.fn(async () => ({
        ...passport,
        completeness: 'complete' as const,
        missingFields: [],
        normalizedLines: [],
      })),
      readPassport: jest.fn(),
    };
    const messages: string[] = [];
    for (const code of ['trustAnchorsUnavailable', 'trustAnchorNotFound', 'invalidConfiguration']) {
      session.readPassport.mockRejectedValueOnce({ code });
      const c = new CaptureFlowController(async () => makeSession(session), {}, jest.fn());
      await c.scan();
      await c.review();
      await c.read();
      messages.push(c.state.sheet?.message ?? '');
    }
    for (const message of messages) {
      expect(message).not.toMatch(/contact support/i);
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe('6 verdict wording', () => {
  test('an issued observation is reported as the service reported it, not as confirmed', async () => {
    const f = await render(
      <SSNResultDetails
        key="ssn"
        receipt={{ ...ssnReceipt, operationID: 'o', checkedAt: '2026-10-08T12:00:00Z', issuance: 'issued' }}
      />,
    );
    expect(f.text()).not.toContain('Issuance confirmed');
    expect(f.text()).toContain('The number was issued');
    await act(async () => {
      f.view.unmount();
    });
  });
  test('absent DG14 hides unperformed chip authentication and PACE reports its recorded cause', async () => {
    const f = await render(
      <CaptureResultDetails
        result={{
          session: makeSession(mockSession),
          passport: {
            ...passport,
            declaredDataGroups: ['DG1', 'DG2'],
            protocols: {
              ...passport.protocols,
              pace: 'failed',
              chipAuthentication: 'notPerformed',
              activeAuthentication: 'notPerformed',
            },
            paceFailure: { stage: 'cardAccess', code: 'cardAccessAbsent', statusWord: 0x6a82 },
          },
        }}
      />,
    );
    expect(f.text()).toContain('PACE parameters were unavailable');
    expect(f.text()).not.toContain('View check details');
    expect(f.text()).not.toContain('Hide check details');
    expect(f.text()).not.toContain('Chip authentication');
    expect(f.text()).not.toContain('Active authentication');
    expect(f.text()).toContain('CardAccess file was not found');
    expect(f.text()).toContain('PACE parameters unavailable; BAC succeeded');
    expect(f.text()).not.toContain('Did not complete; BAC succeeded');
    expect(f.text()).toContain("Reading the chip's PACE capabilities");
    expect(f.text()).toContain('6A82');
    await act(async () => {
      f.view.unmount();
    });
  });
  test.each([
    { stage: 'cardAccessRead' as const, code: 'cardResponse' as const, statusWord: 0x6a82 },
    { stage: 'keyExchange' as const, code: 'protocolFailure' as const, statusWord: null },
  ])('other PACE failures keep the incomplete-exchange summary ($code)', async (paceFailure) => {
    const f = await render(
      <CaptureResultDetails
        result={{
          session: makeSession(mockSession),
          passport: {
            ...passport,
            protocols: { ...passport.protocols, pace: 'failed', basicAccessControl: 'succeeded' },
            paceFailure,
          },
        }}
      />,
    );
    expect(f.text()).not.toContain('View check details');
    expect(f.text()).not.toContain('Hide check details');
    expect(f.text()).toContain('Did not complete; BAC succeeded');
    expect(f.text()).not.toContain('PACE parameters unavailable; BAC succeeded');
    await act(async () => f.view.unmount());
  });
  test('successful BAC fallback is not presented as a failed chip integrity check', async () => {
    const f = await render(
      <CaptureResultDetails
        result={{
          session: makeSession(mockSession),
          passport: {
            ...passport,
            protocols: { ...passport.protocols, pace: 'failed', basicAccessControl: 'succeeded' },
          },
        }}
      />,
    );
    expect(f.text()).toContain('The chip was opened using BAC');
    expect(f.text()).not.toContain('PACE connection failed');
    expect(f.text()).not.toContain('View check details');
    expect(f.text()).not.toContain('Hide check details');
    expect(f.text()).toContain('Did not complete; BAC succeeded');
    expect(f.text()).toContain('The reason was not recorded with this saved read');
    await act(async () => {
      f.view.unmount();
    });
  });
  test('active and chip authentication failures show on the passport card without opening check details', async () => {
    const failed = {
      ...passport,
      protocols: {
        ...passport.protocols,
        activeAuthentication: 'failed' as const,
        chipAuthentication: 'failed' as const,
      },
    };
    const f = await render(
      <CaptureResultDetails key="capture" result={{ session: makeSession(mockSession), passport: failed }} />,
    );
    const card = f.view.root.findByProps({ testID: 'passport-result' });
    expect(JSON.stringify(f.text())).toContain('Active authentication failed');
    expect(
      card.findAll((node) => node.props.children === 'Active authentication failed').length,
    ).toBeGreaterThan(0);
    expect(
      card.findAll((node) => node.props.children === 'Chip authentication failed').length,
    ).toBeGreaterThan(0);
    await act(async () => {
      f.view.unmount();
    });
  });
  test('the issuer chain row does not claim revocation or expiry checking', async () => {
    const f = await render(
      <CaptureResultDetails key="capture" result={{ session: makeSession(mockSession), passport }} />,
    );
    expect(f.text()).not.toContain('View check details');
    expect(f.text()).not.toContain('Hide check details');
    expect(f.text()).toContain('revocation and expiry are not checked');
    await act(async () => {
      f.view.unmount();
    });
  });
  test('a reopened passport says its chip checks were recorded then and not repeated; a new read says read at', async () => {
    const reopened = await render(
      <CaptureResultDetails key="capture" result={{ session: makeSession(mockSession), passport }} />,
    );
    const card = reopened.view.root.findByProps({ testID: 'passport-result' });
    expect(card.findAll((node) => node.props.children === 'Chip checks recorded').length).toBeGreaterThan(0);
    expect(reopened.text()).toContain('Opening saved results does not repeat them');
    expect(reopened.text()).not.toContain('Read at');
    await act(async () => {
      reopened.view.unmount();
    });
    const fresh = await render(
      <CaptureResultDetails
        key="capture"
        result={{
          session: makeSession(mockSession),
          passport: { ...passport, protocolVerdicts: { source: 'thisRead' } },
        }}
      />,
    );
    expect(fresh.text()).toContain('Read at');
    expect(fresh.text()).not.toContain('Chip checks recorded');
    await act(async () => {
      fresh.view.unmount();
    });
  });
  test('the face card matches the code: every shown comparison carries accepted depth', async () => {
    const f = await render(
      <CaptureResultDetails
        key="capture"
        result={{ session: makeSession(mockSession), passport, comparison }}
        focus="face"
      />,
    );
    expect(f.text()).not.toContain('TrueDepth liveness');
    expect(f.text()).not.toContain('Depth evidence unavailable');
    expect(f.text()).toContain('Passed — paired TrueDepth face relief accepted');
    expect(f.text()).toContain('Cosine similarity score');
    expect(f.text()).toContain('Comparison route');
    expect(f.text()).toContain('Depth samples');
    expect(f.text()).not.toContain('View check details');
    expect(f.text()).toContain('0.55');
    await act(async () => {
      f.view.update(
        <CaptureResultDetails
          key="capture"
          result={{
            session: makeSession(mockSession),
            passport,
            comparison: {
              ...comparison,
              admissionReceipt: without(comparison.admissionReceipt, 'depthEvidence'),
            },
          }}
          focus="face"
        />,
      );
    });
    expect(f.text()).not.toContain('Photos match');
    expect(f.text()).toContain('no depth record');
    await act(async () => {
      f.view.unmount();
    });
  });
});

describe('7 configuration', () => {
  test('a missing trust anchor disables the Passport card, with its disabled state announced', async () => {
    const f = await render(<App configuration={{}} />);
    const card = f.view.root.findByProps({ testID: 'open-capture-flow' });
    expect(card.props.disabled).toBe(true);
    expect(card.props.accessibilityState).toEqual({ disabled: true });
    expect(f.text()).toContain('Passport chip checking is not set up in this app');
    await act(async () => {
      f.view.unmount();
    });
  });
  test('missing face models disable Face match even when a passport photo exists', async () => {
    const config: Configuration = {
      trustAnchorsURL: 'file:///anchors.pem',
      results: { directoryURL: 'file:///r', keychainService: 's', keychainAccount: 'a' },
    };
    mockSession.listResults.mockResolvedValue([
      {
        id: 'saved',
        revision: 1,
        recordedAt: '2026-10-08T12:00:00Z',
        kind: 'passport-read-v1',
        workflowID: 'saved',
        artifacts: [],
      },
    ]);
    const f = await render(<App configuration={config} />);
    const card = f.view.root.findByProps({ testID: 'face-match-card' });
    expect(card.props.disabled).toBe(true);
    expect(f.text()).toContain('Face comparison is not set up in this app');
    await act(async () => {
      f.view.unmount();
    });
  });
});

describe('8 accessibility', () => {
  test('the restore-error sheet hides the screen behind it from assistive technology', async () => {
    mockSession.listResults.mockRejectedValue({ code: 'resultIntegrityFailure' });
    const f = await render(
      <App
        configuration={{ results: { directoryURL: 'file:///r', keychainService: 's', keychainAccount: 'a' } }}
      />,
    );
    const background = required(
      f.view.root
        .findAllByProps({ testID: 'identity-hub' })
        .find((node) => node.props.accessibilityElementsHidden !== undefined),
    );
    expect(background.props.accessibilityElementsHidden).toBe(true);
    expect(background.props.importantForAccessibility).toBe('no-hide-descendants');
    await act(async () => {
      f.view.unmount();
    });
  });
  test('camera controls and review images flow with the layout instead of fixed heights and absolute placement', () => {
    expect(StyleSheet.flatten(styles.cameraBottom)).not.toHaveProperty('position', 'absolute');
    expect(StyleSheet.flatten(styles.image)).not.toHaveProperty('height');
  });
});

describe('9 privacy', () => {
  test('no personal value is selectable on any result screen', async () => {
    const trees = [
      <CaptureResultDetails
        key="capture"
        result={{ session: makeSession(mockSession), passport, comparison }}
      />,
      <SSNResultDetails
        key="ssn"
        receipt={{
          ...ssnReceipt,
          operationID: 'o',
          checkedAt: '2026-10-08T12:00:00Z',
          issuance: 'issued',
          details: {
            source: 's',
            responseCode: 0,
            reportedStatus: 'r',
            region: 'CA',
            issueStart: '1978-01-01',
          },
        }}
      />,
      <PhoneResultDetails key="phone" receipt={{ ...phoneReceipt, subscriberComparison: subscriber }} />,
      <DocumentResultDetails
        key="document"
        result={{
          session: makeSession(mockSession),
          document: {
            workflowID: 'w',
            front: {
              captureID: 'f',
              sha256: 'f',
              side: 'front',
              pdf417: null,
              pdf417Status: 'notRequested',
              sideCorrespondence: null,
            },
            back: {
              captureID: 'b',
              sha256: 'b',
              side: 'back',
              pdf417Status: 'readable',
              sideCorrespondence: { jurisdiction: 'matches', documentNumber: 'found', frontReading: 'read' },
              pdf417: {
                status: 'readable',
                fields: { DAQ: 'TEST123', DCS: 'SPECIMEN' },
                version: 10,
                issuerIIN: '636000',
                jurisdictionVersion: 0,
                missingRequiredElements: [],
              },
            },
          },
        }}
      />,
    ];
    for (const tree of trees) {
      const f = await render(tree);
      expect(selectable(f.view.root)).toHaveLength(0);
      await act(async () => {
        f.view.unmount();
      });
    }
  });
});
