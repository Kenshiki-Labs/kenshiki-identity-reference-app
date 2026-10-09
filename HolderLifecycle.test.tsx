import React from 'react';
import {AppState} from 'react-native';
import renderer, {act} from 'react-test-renderer';
import type {CaptureEvent, Configuration, DocumentObservation, IdentityCaptureSession, PassportObservation} from '@kenshiki/identity-capture';
import App from './App';
import {DocumentFlowController} from './DocumentFlowController';

// Lifecycle review repros J1, J3, J4 and J5 (rn-qa-4), ported as Fix B tests. Mock tier.
// J2 (holder-scoped native stores) is native configuration; it is covered in ArtifactIntegrationTests.
type Holder = 'A' | 'B';
const passportFor = (surname: string, givenNames: string): PassportObservation => ({
  documentNumber: surname === 'ALPHA' ? 'A0000001' : 'B0000002', birthDateYYMMDD: '850615', expiryDateYYMMDD: '320101',
  surname, givenNames, nationality: 'UTO', issuingState: 'UTO', sex: 'F',
  portraitAvailable: true, portraitSHA256: 'portrait-' + surname, personalNumber: null, dateOfIssue: null,
  issuingAuthority: null, placeOfBirth: null, correspondence: {documentNumber: 'matches'},
  protocols: {basicAccessControl: 'succeeded', pace: 'notPerformed', activeAuthentication: 'notPerformed',
    chipAuthentication: 'notPerformed', countrySigningChain: 'succeeded', documentSignature: 'succeeded', dataGroupHashes: 'succeeded'},
});
function mockSessionFor(holder: Holder) {
  const saved = holder === 'A';
  let erased = false;
  const issued = {state: 'completed', entryDigits: '', confirmation: null, attempt: null,
    receipt: {operationID: 'op', checkedAt: '2027-01-15T08:00:00Z', issuance: 'issued',
      details: {source: 'Synthetic', responseCode: 0, reportedStatus: '1', region: 'CA', issueStart: '1978-01-01'}},
    failure: null, recoveryNeeded: false, busy: false};
  const ready = {state: 'ready', entryDigits: '', confirmation: null, attempt: null, receipt: null, failure: null, recoveryNeeded: false, busy: false};
  return {
    id: 'session-' + holder,
    subscribe: jest.fn((_listener: (event: CaptureEvent) => void) => jest.fn()),
    listResults: jest.fn(async () => saved ? [{kind: 'passport-read-v1', workflowID: 'workflow-A', artifacts: []}] : []),
    recoverPassport: jest.fn(async () => passportFor('ALPHA', 'ANNA')),
    eraseResults: jest.fn(async () => {}),
    ssnSnapshot: jest.fn(async () => saved && !erased ? issued : ready),
    ssnCancel: jest.fn(async () => saved && !erased ? issued : ready),
    ssnErase: jest.fn(async () => { erased = true; }),
    cancel: jest.fn(async () => {}), release: jest.fn(async () => {}),
  };
}
const mockSessions: Record<Holder, ReturnType<typeof mockSessionFor>> = {A: mockSessionFor('A'), B: mockSessionFor('B')};
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: {create: jest.fn(async (configuration: {results?: {keychainService: string}; ssn?: {keychainService: string}}) => {
    const service = configuration.results?.keychainService ?? configuration.ssn?.keychainService ?? '';
    return mockSessions[service.includes('holder-b') ? 'B' : 'A'];
  })},
  IdentityCapturePreview: 'MockCapturePreview', IdentityCaptureImage: 'MockCaptureImage',
}));
const holderConfig = (holder: Holder): Configuration => {
  const scope = holder === 'A' ? 'holder-a' : 'holder-b';
  return {
    trustAnchorsURL: 'file:///anchors.pem',
    results: {directoryURL: `file:///support/IdentityHolders/${scope}/Results`, keychainService: `app.identity.${scope}.results`, keychainAccount: 'completed-results-v1'},
    ssn: {context: {credentialID: scope}, workflowID: '00000000-0000-4000-8000-00000000000' + (holder === 'A' ? '1' : '2'), providerID: 'agency',
      directoryURL: `file:///support/IdentityHolders/${scope}/SSN`, keychainService: `app.identity.${scope}.ssn`, keychainAccount: 'issuance-evidence-v1'},
  };
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSessions.A = mockSessionFor('A'); mockSessions.B = mockSessionFor('B');
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({remove: jest.fn()}));
});
afterEach(() => jest.restoreAllMocks());
const text = (view: renderer.ReactTestRenderer) => JSON.stringify(view.toJSON());
const press = (view: renderer.ReactTestRenderer, id: string) => act(async () => {
  await view.root.findAllByProps({testID: id}).filter(node => typeof node.props.onPress === 'function').at(-1)!.props.onPress();
});

test('J1 a holder switch clears the previous holder from the screen and releases every owned session first', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<App configuration={holderConfig('A')} />); });
  await press(view, 'open-ssn'); await press(view, 'finish-ssn');
  expect(text(view)).toContain('ANNA ALPHA');
  await act(async () => { view.update(<App configuration={holderConfig('B')} />); });
  const after = text(view);
  expect(after).not.toContain('ANNA ALPHA');
  expect(after).not.toContain('Reported as issued');
  expect(mockSessions.A.release).toHaveBeenCalled();
  expect(mockSessions.A.release.mock.invocationCallOrder[0]).toBeLessThan(mockSessions.B.listResults.mock.invocationCallOrder[0]);
  await act(async () => { view.unmount(); });
});

test('J3 an unreadable saved store offers erase as well as reopen, behind a confirmation', async () => {
  mockSessions.A.listResults.mockRejectedValue({code: 'resultIntegrityFailure'});
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<App configuration={holderConfig('A')} />); });
  expect(text(view)).toContain('Saved results could not be opened');
  await press(view, 'erase-unreadable-results');
  expect(mockSessions.A.eraseResults).not.toHaveBeenCalled();
  await act(async () => { await view.root.findAllByProps({label: 'Clear results'}).at(-1)!.props.onPress(); });
  expect(mockSessions.A.eraseResults).toHaveBeenCalledTimes(1);
  expect(text(view)).not.toContain('Saved results could not be opened');
  await act(async () => { view.unmount(); });
});

test('J4 the SSN screen offers erase through ssnErase after a confirmation', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<App configuration={holderConfig('A')} />); });
  await press(view, 'open-ssn'); await press(view, 'ssn-erase');
  expect(mockSessions.A.ssnErase).not.toHaveBeenCalled();
  await press(view, 'ssn-confirm-erase');
  expect(mockSessions.A.ssnErase).toHaveBeenCalledTimes(1);
  expect(text(view)).not.toContain('Reported as issued');
  await act(async () => { view.unmount(); });
});

test('J5 a back from a different document is refused with its own message and the front-only draft is kept', async () => {
  let listener!: (event: CaptureEvent) => void;
  const front = {captureID: 'front-of-holder-A', sha256: 'a', side: 'front' as const, pdf417: null, pdf417Status: 'notRequested' as const};
  const draft: DocumentObservation = {workflowID: 'w-A', front, back: null};
  const session = {
    id: 'doc', subscribe: jest.fn((l: (event: CaptureEvent) => void) => { listener = l; return jest.fn(); }),
    listDocuments: jest.fn(async () => [{captureID: front.captureID, workflowID: 'w-A', side: 'front', sha256: 'a'}]),
    recoverDocument: jest.fn(async () => draft), startDocument: jest.fn(async () => {}),
    documentResult: jest.fn(async () => draft), cancel: jest.fn(async () => {}), release: jest.fn(async () => {}),
  };
  const c = new DocumentFlowController(async () => session as unknown as IdentityCaptureSession, {document: {
    directoryURL: 'file:///d', keychainService: 's', keychainAccount: 'a', requiresLocation: false}}, jest.fn());
  await c.open(); await c.startBack();
  listener({type: 'failure', capability: 'document', code: 'documentSidesMismatch'});
  for (let i = 0; i < 12; ++i) await Promise.resolve();
  expect(c.state.completed).toBeUndefined();
  expect(c.state.draft?.front?.captureID).toBe('front-of-holder-A');
  expect(c.state.sheet?.message).toContain('different license');
  await c.dispose();
});
