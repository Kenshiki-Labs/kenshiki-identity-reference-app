import React from 'react';
import {AppState, StyleSheet, type ViewStyle} from 'react-native';
import renderer, {act, type ReactTestInstance} from 'react-test-renderer';
import type {
  CaptureEvent, Configuration, DocumentCheckSnapshot, DocumentObservation, FaceComparison, IdentityCaptureSession,
  PassportObservation, PhoneCheckReceipt, PhoneCheckSnapshot, SSNSessionSnapshot, SubscriberComparisonFailure,
  SubscriberComparisonResult,
} from '@kenshiki/identity-capture';
import App from './App';
import {CaptureFlowController} from './CaptureFlowController';
import {DocumentCheckPanel} from './DocumentCheckPanel';
import {DocumentFlowController} from './DocumentFlowController';
import {DocumentResultDetails} from './DriverLicenseFlow';
import {CaptureResultDetails, styles} from './IdentityCaptureFlow';
import {IdentitySheetHost} from './IdentitySheetHost';
import {PhoneResultDetails} from './PhoneFlow';
import {SSNResultDetails} from './SSNFlow';
import {SubscriberResultDetails} from './SubscriberResultDetails';

// Reference-app findings of the 8 October 2026 fix brief (Fix B). Mock tier: jest with mocked sessions.
let mockListener: ((event: CaptureEvent) => void) | undefined;
const mockSession: Record<string, jest.Mock> & {id: string} = {id: 'session'} as never;
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: {create: jest.fn(async () => mockSession)},
  IdentityCapturePreview: 'MockCapturePreview', IdentityCaptureImage: 'MockCaptureImage',
}));

const passport: PassportObservation = {
  documentNumber: 'X1234567', birthDateYYMMDD: '850615', expiryDateYYMMDD: '320101',
  surname: 'SPECIMEN', givenNames: 'SYNTHETIC', nationality: 'UTO', issuingState: 'UTO', sex: 'F',
  portraitAvailable: true, portraitSHA256: 'reference', personalNumber: null, dateOfIssue: null,
  issuingAuthority: null, placeOfBirth: null, correspondence: {documentNumber: 'matches'},
  protocols: {basicAccessControl: 'succeeded', pace: 'notPerformed', activeAuthentication: 'notPerformed',
    chipAuthentication: 'notPerformed', countrySigningChain: 'succeeded', documentSignature: 'succeeded', dataGroupHashes: 'succeeded'},
  savedResult: {id: 'p', workflowID: 'w', kind: 'passport-read-v1', revision: 1, recordedAt: '2026-10-08T12:00:00Z', artifacts: []},
};
const depth = {imageSHA256: 'selfie', filtered: false, ageAtAdmission: 0.01, measurement: {sampleCount: 255, residualRMS: 0.019,
  policy: {identifier: 'policy', minimumResidualRMS: 0.004, minimumSamples: 64, maximumDepthAge: 0.25, nearLimit: 0.15, farLimit: 1.2, samplesPerAxis: 16}}};
const comparison: FaceComparison = {similarity: 0.55, outcome: 'pass', implementationVersion: 'test',
  referenceSHA256: 'reference', selfieSHA256: 'selfie', route: 'scrfd', modelLoadingSeconds: 0, comparisonSeconds: 1,
  admissionReceipt: {policyVersion: 'test', trigger: 'automatic', eyesOpen: true, blinkAge: 0,
    consecutiveTrackedFrames: 10, steadyHoldDuration: 1, depthEvidence: depth},
  savedResult: {id: 'f', workflowID: 'w', kind: 'face-comparison-v1', revision: 1, recordedAt: '2026-10-08T12:05:00Z', artifacts: []}};
const phoneReady: PhoneCheckSnapshot = {stage: 'start', busy: false, failure: null, pending: false, sent: false,
  challengeReserved: false, receipt: null, recordedAt: null, sendAgainAt: null};
const phoneReceipt: PhoneCheckReceipt = {challengeID: 'synthetic', sender: '12025550123', messageHash: 'a'.repeat(64),
  receivedAt: '2026-10-08T12:00:00Z', completedAt: '2026-10-08T12:00:01Z'};
const subscriber: SubscriberComparisonResult = {
  operationID: 'comparison', profileVersion: 'profile', subjectRevision: 'subject', numberVerificationReference: 'synthetic',
  completedAt: '2026-10-08T12:00:02Z',
  provider: {providerID: 'synthetic-provider-id', product: 'synthetic-product', apiVersion: 'v1', adapterVersion: 'v1', reviewRevision: 'r'},
  checks: [{name: 'givenName', submitted: true, compared: true, outcome: 'noMatch', scope: 'individualAttribute', coveredInputs: ['givenName'], reason: 'reportedGrade'}],
  evaluation: {status: 'notSatisfied', policyVersion: 'policy', requiredChecks: ['givenName'],
    gradePolicy: {givenName: ['exactMatch'], familyName: ['exactMatch'], birthDate: ['exactMatch'], addressLines: ['exactMatch'],
      city: ['exactMatch'], region: ['exactMatch'], postalCode: ['exactMatch'], country: ['exactMatch']},
    outsidePolicyChecks: ['givenName'], incompleteChecks: [], sourceFreshness: 'unknownTimeAllowed'},
  source: {kind: 'operator', observedAt: '2026-10-08T11:00:00Z'},
};
const ssnReady: SSNSessionSnapshot = {state: 'ready', entryDigits: '', confirmation: null, attempt: null,
  receipt: null, failure: null, recoveryNeeded: false, busy: false};
let phoneSnapshot = phoneReady;

beforeEach(() => {
  jest.clearAllMocks();
  mockListener = undefined; phoneSnapshot = phoneReady;
  for (const key of Object.keys(mockSession)) if (key !== 'id') delete mockSession[key];
  Object.assign(mockSession, {
    subscribe: jest.fn((listener: (event: CaptureEvent) => void) => { mockListener = listener; return () => { mockListener = undefined; }; }),
    release: jest.fn(async () => {}), cancel: jest.fn(async () => {}),
    listResults: jest.fn(async () => []), eraseResults: jest.fn(async () => {}),
    recoverPassport: jest.fn(async () => passport), recoverFace: jest.fn(async () => comparison),
    phoneSnapshot: jest.fn(async () => phoneSnapshot), phoneCancel: jest.fn(async () => phoneSnapshot),
    phoneStartOver: jest.fn(async () => ({...phoneReady, pending: true})), phoneErase: jest.fn(async () => {}),
    ssnSnapshot: jest.fn(async () => ssnReady), ssnCancel: jest.fn(async () => ssnReady), ssnErase: jest.fn(async () => {}),
    listDocuments: jest.fn(async () => []),
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({remove: jest.fn()}));
});
afterEach(() => jest.restoreAllMocks());

async function render(element: React.ReactElement) {
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(element); });
  const tap = async (id: string) => act(async () => {
    const button = view.root.findAllByProps({testID: id}).filter(node => typeof node.props.onPress === 'function').at(-1);
    if (!button) throw new Error('Missing ' + id);
    await button.props.onPress();
  });
  const press = async (label: string) => act(async () => {
    const button = view.root.findAll(node => node.props.label === label && typeof node.props.onPress === 'function').at(-1);
    if (!button) throw new Error('Missing ' + label);
    await button.props.onPress();
  });
  const text = () => JSON.stringify(view.toJSON());
  return {view, tap, press, text};
}
const selectable = (root: ReactTestInstance) => root.findAll(node => node.props.selectable === true);

describe('1 developer checks', () => {
  test('a normal launch has no Developer checks entry; only the simulator debug host passes it in', async () => {
    const plain = await render(<App />);
    expect(plain.view.root.findAllByProps({testID: 'open-sdk-checks'})).toHaveLength(0);
    await act(async () => { plain.view.unmount(); });
    const developer = await render(<App developerChecks />);
    expect(developer.view.root.findAllByProps({testID: 'open-sdk-checks'}).length).toBeGreaterThan(0);
    await act(async () => { developer.view.unmount(); });
  });
});

describe('2 contradicted carrier verdict stops', () => {
  test.each([
    ['carrier comparison contradicted', {...phoneReceipt, subjectComparison: {status: 'contradicted' as const, fieldsCompared: ['givenName'], checkedAt: '2026-10-08T12:00:01Z'}}],
    ['subscriber comparison not satisfied', {...phoneReceipt, subscriberComparison: subscriber}],
  ])('%s stops with a retry instead of confirming possession and offering Done', async (_name, receipt) => {
    phoneSnapshot = {...phoneReady, stage: 'completed', receipt};
    const f = await render(<App />); await f.tap('open-phone');
    expect(f.text()).not.toContain('Phone possession confirmed');
    expect(f.view.root.findAllByProps({testID: 'phone-done'})).toHaveLength(0);
    expect(f.view.root.findAllByProps({testID: 'phone-stopped'}).length).toBeGreaterThan(0);
    await f.tap('phone-retry');
    expect(f.view.root.findAllByProps({testID: 'phone-bottom-sheet'}).length).toBeGreaterThan(0);
    await f.tap('phone-confirm'); expect(mockSession.phoneStartOver).toHaveBeenCalledWith(true);
    await act(async () => { f.view.unmount(); });
  });
  test('the Identity card does not report a stopped check as an available result', async () => {
    phoneSnapshot = {...phoneReady, stage: 'completed', receipt: {...phoneReceipt,
      subjectComparison: {status: 'contradicted', fieldsCompared: ['givenName'], checkedAt: '2026-10-08T12:00:01Z'}}};
    const f = await render(<App />); await f.tap('open-phone'); await f.tap('phone-back');
    expect(f.text()).toContain('Check stopped');
    expect(f.text()).not.toContain('Result available');
    await act(async () => { f.view.unmount(); });
  });
});

describe('3 providers are described by function', () => {
  test('provider names, sources and identifiers are not rendered and no row depends on a vendor name', async () => {
    const receipt: PhoneCheckReceipt = {...phoneReceipt, subjectComparison: {status: 'agreed', fieldsCompared: ['givenName'], checkedAt: '2026-10-08T12:00:01Z',
      evidence: {requestID: 'request', providers: [{source: 'synthetic-source-label', answered: true, smsFraudRiskScore: 3, formatValid: true}],
        fields: [{field: 'givenName', source: 'synthetic-source-label', grade: 'match'}]}}};
    const f = await render(<PhoneResultDetails receipt={receipt} />);
    expect(f.text()).not.toContain('synthetic-source-label');
    expect(f.text()).toContain('3'); expect(f.text()).not.toContain('Risk advisor score');
    await act(async () => { f.view.unmount(); });
    const s = await render(<SubscriberResultDetails result={subscriber} />);
    expect(s.text()).not.toContain('synthetic-provider-id'); expect(s.text()).not.toContain('synthetic-product');
    await act(async () => { s.view.unmount(); });
  });
});

describe('4 typed error handling', () => {
  test('a failed erase names its cause instead of one generic sentence', async () => {
    const durable: Configuration = {results: {directoryURL: 'file:///r', keychainService: 's', keychainAccount: 'a'}};
    mockSession.listResults.mockResolvedValue([{kind: 'passport-read-v1', workflowID: 'saved', artifacts: []}]);
    mockSession.eraseResults.mockRejectedValueOnce({code: 'busy'});
    const f = await render(<App configuration={durable} />);
    await f.tap('open-capture-flow'); await f.press('Clear results');
    await act(async () => { await f.view.root.findAllByProps({label: 'Clear results'}).at(-1)!.props.onPress(); });
    expect(f.text()).toContain('Another check is still finishing');
    await act(async () => { f.view.unmount(); });
  });
  test('the document check panel renders snapshot.failure and command failures by code', async () => {
    const unavailable: DocumentCheckSnapshot = {captureID: 'c', sourceSHA256: 's', state: 'unavailable', result: null, checkedAt: null, failure: 'serviceUnavailable'};
    const session = {documentCheckRestore: jest.fn(async () => unavailable), documentCheck: jest.fn(async () => { throw {code: 'consentRequired'}; }),
      cancel: jest.fn(async () => {})} as unknown as IdentityCaptureSession;
    const f = await render(<IdentitySheetHost><DocumentCheckPanel session={session} configured /></IdentitySheetHost>);
    expect(f.text()).toContain('The checking service did not answer');
    await act(async () => { f.view.update(<IdentitySheetHost><DocumentCheckPanel session={{...session,
      documentCheckRestore: jest.fn(async () => ({...unavailable, state: 'notStarted', failure: null}))} as unknown as IdentityCaptureSession} configured /></IdentitySheetHost>); });
    await f.press('Check license record');
    expect(f.text()).toContain('Agree to the record check');
    await act(async () => { f.view.unmount(); });
  });
  test('camera restricted and camera unavailable are different document messages', async () => {
    const start = jest.fn();
    const make = (code: string) => {
      const session = {subscribe: jest.fn(() => jest.fn()), startDocument: jest.fn(async () => { throw {code}; }),
        listDocuments: jest.fn(async () => []), cancel: jest.fn(async () => {}), release: jest.fn(async () => {}), documentResult: start};
      return new DocumentFlowController(async () => session as unknown as IdentityCaptureSession, {}, jest.fn());
    };
    const restricted = make('cameraPermissionRestricted'); await restricted.startFront();
    const unavailable = make('backCameraUnavailable'); await unavailable.startFront();
    expect(restricted.state.sheet?.title).not.toBe(unavailable.state.sheet?.title);
    expect(restricted.state.sheet?.message).toContain('restricted');
  });
  test('PDF417 notFound, ambiguous and failed and AAMVA malformed and unsupported each get their own text', async () => {
    const front = {captureID: 'f', sha256: 'f', side: 'front' as const, pdf417: null, pdf417Status: 'notRequested' as const};
    const back = (pdf417Status: 'notFound' | 'ambiguous' | 'failed' | 'readable', status?: 'malformed' | 'unsupported'): DocumentObservation => ({
      workflowID: 'w', front, back: {captureID: 'b', sha256: 'b', side: 'back', pdf417Status,
        pdf417: status ? {status, fields: {}, version: null, issuerIIN: null, jurisdictionVersion: null, missingRequiredElements: []} : null}});
    const shown: string[] = [];
    for (const document of [back('notFound'), back('ambiguous'), back('failed'), back('readable', 'malformed'), back('readable', 'unsupported')]) {
      const f = await render(<DocumentResultDetails result={{session: mockSession as unknown as IdentityCaptureSession, document}} />);
      shown.push(f.view.root.findByProps({testID: 'document-barcode-status'}).props.children);
      await act(async () => { f.view.unmount(); });
    }
    expect(new Set(shown).size).toBe(5);
  });
  test('every subscriber failure has its own text', async () => {
    const failures: SubscriberComparisonFailure[] = ['busy', 'consentRequired', 'invalidRequest', 'contextChanged', 'storageUnavailable',
      'notDispatched', 'outcomeUnknown', 'invalidResponse'];
    const shown = new Set<string>();
    for (const failure of failures) {
      const f = await render(<SubscriberResultDetails failure={failure} />);
      shown.add(f.text()); await act(async () => { f.view.unmount(); });
    }
    expect(shown.size).toBe(failures.length);
  });
});

describe('5 what the holder sees', () => {
  test('document check results show no raw provider keys, check names or correction codes', async () => {
    const checked: DocumentCheckSnapshot = {captureID: 'c', sourceSHA256: 's', state: 'checked', checkedAt: '2026-10-08T12:00:00Z', failure: null,
      result: {outcome: 'needsCorrection', operationID: 'op', providerStatus: 'raw-provider-status', replayed: false,
        providerChecks: [{name: 'raw_check_name', status: 'raw_status', reasons: ['raw_reason'], metadataJSON: JSON.stringify({'raw-meta-key': 'x'})}],
        submittedFields: {givenName: 'SYNTHETIC'}, correctable: [{field: 'givenName', code: 'raw_correction_code'}]}};
    const session = {documentCheckRestore: jest.fn(async () => checked), cancel: jest.fn(async () => {})} as unknown as IdentityCaptureSession;
    const f = await render(<IdentitySheetHost><DocumentCheckPanel session={session} configured /></IdentitySheetHost>);
    await f.press('Review requested corrections');
    for (const raw of ['raw_check_name', 'raw_status', 'raw-meta-key', 'raw-provider-status', 'raw_correction_code', '"givenName"', '2026-10-08T12:00:00Z']) {
      expect(f.text()).not.toContain(raw);
    }
    expect(f.text()).toContain('Given name'); expect(f.text()).toContain('SYNTHETIC');
    await act(async () => { f.view.unmount(); });
  });
  test('passport, face, SSN, phone and saved-list timestamps are formatted for a person', async () => {
    const shown: string[] = [];
    const p = await render(<CaptureResultDetails result={{session: mockSession as unknown as IdentityCaptureSession, passport, comparison}} focus="face" />);
    shown.push(p.text()); await act(async () => { p.view.unmount(); });
    const s = await render(<SSNResultDetails receipt={{operationID: 'o', checkedAt: '2026-10-08T12:00:00Z', issuance: 'notIssued'}} />);
    shown.push(s.text()); await act(async () => { s.view.unmount(); });
    const ph = await render(<PhoneResultDetails receipt={phoneReceipt} />);
    shown.push(ph.text()); await act(async () => { ph.view.unmount(); });
    for (const value of shown) {
      expect(value).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      expect(value).toContain('Oct 8, 2026');
    }
    mockSession.listResults.mockResolvedValue([
      {kind: 'passport-read-v1', workflowID: 'first', recordedAt: '2026-10-08T12:00:00Z', artifacts: []},
      {kind: 'passport-read-v1', workflowID: 'second', recordedAt: '2026-10-07T12:00:00Z', artifacts: []}]);
    const list = await render(<App configuration={{trustAnchorsURL: 'file:///anchors.pem', results: {directoryURL: 'file:///r', keychainService: 's', keychainAccount: 'a'}}} />);
    await list.tap('open-capture-flow');
    expect(list.text()).not.toContain('2026-10-08T12:00:00Z'); expect(list.text()).toContain('Oct 8, 2026');
    await act(async () => { list.view.unmount(); });
  });
  test('configuration failures say what the holder can do, never contact an unnamed support', async () => {
    const session = {subscribe: jest.fn(() => jest.fn()), cancel: jest.fn(async () => {}), release: jest.fn(async () => {}),
      startMRZ: jest.fn(async () => {}), captureMRZ: jest.fn(async () => ({...passport, completeness: 'complete', missingFields: [], normalizedLines: []})),
      readPassport: jest.fn()};
    const messages: string[] = [];
    for (const code of ['trustAnchorsUnavailable', 'trustAnchorNotFound', 'invalidConfiguration']) {
      session.readPassport.mockRejectedValueOnce({code});
      const c = new CaptureFlowController(async () => session as unknown as IdentityCaptureSession, {}, jest.fn());
      await c.scan(); await c.review(); await c.read(); messages.push(c.state.sheet?.message ?? '');
    }
    for (const message of messages) { expect(message).not.toMatch(/contact support/i); expect(message.length).toBeGreaterThan(0); }
  });
});

describe('6 verdict wording', () => {
  test('an issued observation is reported as the service reported it, not as confirmed', async () => {
    const f = await render(<SSNResultDetails receipt={{operationID: 'o', checkedAt: '2026-10-08T12:00:00Z', issuance: 'issued'}} />);
    expect(f.text()).not.toContain('Issuance confirmed'); expect(f.text()).toContain('Reported as issued');
    await act(async () => { f.view.unmount(); });
  });
  test('active and chip authentication failures show on the passport card without opening check details', async () => {
    const failed = {...passport, protocols: {...passport.protocols, activeAuthentication: 'failed' as const, chipAuthentication: 'failed' as const}};
    const f = await render(<CaptureResultDetails result={{session: mockSession as unknown as IdentityCaptureSession, passport: failed}} />);
    const card = f.view.root.findByProps({testID: 'passport-result'});
    expect(JSON.stringify(f.text())).toContain('Active authentication failed');
    expect(card.findAll(node => node.props.children === 'Active authentication failed').length).toBeGreaterThan(0);
    expect(card.findAll(node => node.props.children === 'Chip authentication failed').length).toBeGreaterThan(0);
    await act(async () => { f.view.unmount(); });
  });
  test('the issuer chain row does not claim revocation or expiry checking', async () => {
    const f = await render(<CaptureResultDetails result={{session: mockSession as unknown as IdentityCaptureSession, passport}} />);
    await f.press('View check details');
    expect(f.text()).toContain('revocation and expiry are not checked');
    await act(async () => { f.view.unmount(); });
  });
  test('the face card matches the code: every shown comparison carries accepted depth', async () => {
    const f = await render(<CaptureResultDetails result={{session: mockSession as unknown as IdentityCaptureSession, passport, comparison}} focus="face" />);
    expect(f.text()).not.toContain('TrueDepth liveness'); expect(f.text()).not.toContain('Depth evidence unavailable');
    expect(f.text()).toContain('Face depth measured with this selfie');
    await act(async () => { f.view.update(<CaptureResultDetails result={{session: mockSession as unknown as IdentityCaptureSession, passport,
      comparison: {...comparison, admissionReceipt: {...comparison.admissionReceipt, depthEvidence: undefined}}}} focus="face" />); });
    expect(f.text()).not.toContain('Photos match');
    expect(f.text()).toContain('no depth record');
    await act(async () => { f.view.unmount(); });
  });
});

describe('7 configuration', () => {
  test('a missing trust anchor disables the Passport card, with its disabled state announced', async () => {
    const f = await render(<App configuration={{}} />);
    const card = f.view.root.findByProps({testID: 'open-capture-flow'});
    expect(card.props.disabled).toBe(true); expect(card.props.accessibilityState).toEqual({disabled: true});
    expect(f.text()).toContain('Passport chip checking is not set up in this app');
    await act(async () => { f.view.unmount(); });
  });
  test('missing face models disable Face match even when a passport photo exists', async () => {
    const config: Configuration = {trustAnchorsURL: 'file:///anchors.pem', results: {directoryURL: 'file:///r', keychainService: 's', keychainAccount: 'a'}};
    mockSession.listResults.mockResolvedValue([{kind: 'passport-read-v1', workflowID: 'saved', artifacts: []}]);
    const f = await render(<App configuration={config} />);
    const card = f.view.root.findByProps({testID: 'face-match-card'});
    expect(card.props.disabled).toBe(true); expect(f.text()).toContain('Face comparison is not set up in this app');
    await act(async () => { f.view.unmount(); });
  });
});

describe('8 accessibility', () => {
  test('the restore-error sheet hides the screen behind it from assistive technology', async () => {
    mockSession.listResults.mockRejectedValue({code: 'resultIntegrityFailure'});
    const f = await render(<App configuration={{results: {directoryURL: 'file:///r', keychainService: 's', keychainAccount: 'a'}}} />);
    const background = f.view.root.findByProps({testID: 'identity-hub'});
    expect(background.props.accessibilityElementsHidden).toBe(true);
    expect(background.props.importantForAccessibility).toBe('no-hide-descendants');
    await act(async () => { f.view.unmount(); });
  });
  test('camera controls and review images flow with the layout instead of fixed heights and absolute placement', () => {
    expect((StyleSheet.flatten(styles.cameraBottom) as ViewStyle).position).not.toBe('absolute');
    expect((StyleSheet.flatten(styles.image) as ViewStyle).height).toBeUndefined();
  });
});

describe('9 privacy', () => {
  test('no personal value is selectable on any result screen', async () => {
    const trees = [
      <CaptureResultDetails result={{session: mockSession as unknown as IdentityCaptureSession, passport, comparison}} />,
      <SSNResultDetails receipt={{operationID: 'o', checkedAt: '2026-10-08T12:00:00Z', issuance: 'issued',
        details: {source: 's', responseCode: 0, reportedStatus: 'r', region: 'CA', issueStart: '1978-01-01'}}} />,
      <PhoneResultDetails receipt={{...phoneReceipt, subscriberComparison: subscriber}} />,
      <DocumentResultDetails result={{session: mockSession as unknown as IdentityCaptureSession, document: {workflowID: 'w',
        front: {captureID: 'f', sha256: 'f', side: 'front', pdf417: null, pdf417Status: 'notRequested'},
        back: {captureID: 'b', sha256: 'b', side: 'back', pdf417Status: 'readable', pdf417: {status: 'readable',
          fields: {DAQ: 'TEST123', DCS: 'SPECIMEN'}, version: 10, issuerIIN: '636000', jurisdictionVersion: 0, missingRequiredElements: []}}}}} />,
    ];
    for (const tree of trees) {
      const f = await render(tree);
      expect(selectable(f.view.root)).toHaveLength(0);
      await act(async () => { f.view.unmount(); });
    }
  });
});
