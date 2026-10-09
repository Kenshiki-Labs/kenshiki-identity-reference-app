import React from 'react';
import renderer, {act} from 'react-test-renderer';
import type {CaptureEvent, PassportObservation, Configuration} from '@kenshiki/identity-capture';
import App from './App';

let mockEvent: (event: CaptureEvent) => void;
const mockPassport: PassportObservation = {
  documentNumber: 'X1234567', birthDateYYMMDD: '850615', expiryDateYYMMDD: '320101',
  surname: 'SPECIMEN', givenNames: 'SYNTHETIC', nationality: 'UTO', issuingState: 'UTO', sex: 'F',
  portraitAvailable: true, portraitSHA256: 'reference', personalNumber: null, dateOfIssue: null,
  issuingAuthority: null, placeOfBirth: null, correspondence: {documentNumber: 'matches'},
  protocolVerdicts: {source: 'thisRead'},
  protocols: {basicAccessControl: 'succeeded', pace: 'notPerformed', activeAuthentication: 'notPerformed',
    chipAuthentication: 'notPerformed', countrySigningChain: 'succeeded', documentSignature: 'succeeded', dataGroupHashes: 'succeeded'},
};
const mockMRZ = {...mockPassport, completeness: 'complete' as const, missingFields: [], normalizedLines: []};
const mockSession = {
  id: 'test', subscribe: jest.fn(listener => { mockEvent = listener; return jest.fn(); }),
  startMRZ: jest.fn(async () => {}), captureMRZ: jest.fn(async () => mockMRZ),
  listResults: jest.fn(async () => [{kind: 'passport-read-v1', workflowID: 'saved-workflow', artifacts: []}]),
  recoverPassport: jest.fn(async () => mockPassport), eraseResults: jest.fn(async () => {}),
  readPassport: jest.fn(async () => mockPassport), cancel: jest.fn(async () => {}), release: jest.fn(async () => {}),
};
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: {create: jest.fn(async () => mockSession)},
  IdentityCapturePreview: 'MockCapturePreview', IdentityCaptureImage: 'MockCaptureImage',
}));

beforeEach(() => jest.clearAllMocks());

test('passport completion returns to cards and results reopen without repeating capture or deleting evidence', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<App configuration={{trustAnchorsURL: 'file:///anchors.pem'}} />); });
  async function tap(id: string) {
    await act(async () => { await view.root.findByProps({testID: id}).props.onPress(); });
  }
  await tap('open-capture-flow'); await tap('start-passport-scan');
  await act(async () => { mockEvent({type: 'mrzObservation', observation: mockMRZ}); });
  await tap('capture-mrz'); await tap('read-passport');
  expect(JSON.stringify(view.toJSON())).toContain('SYNTHETIC SPECIMEN');
  expect(JSON.stringify(view.toJSON())).toContain('PRINTED DETAILS AND CHIP');
  await tap('finish-capture');
  expect(view.root.findByProps({testID: 'face-match-card'})).toBeDefined();
  expect(mockSession.release).not.toHaveBeenCalled();
  await tap('open-capture-flow');
  expect(view.root.findByProps({testID: 'passport-result'})).toBeDefined();
  expect(mockSession.startMRZ).toHaveBeenCalledTimes(1);
  expect(mockSession.readPassport).toHaveBeenCalledTimes(1);
  await act(async () => { view.unmount(); });
  expect(mockSession.release).toHaveBeenCalledTimes(1);
});

const durable: Configuration = {results: {directoryURL: 'file:///private/test-results',
  keychainService: 'synthetic-results', keychainAccount: 'evidence'}};

test('app startup restores the saved passport and erasure removes custody before releasing review', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<App configuration={durable} />); });
  expect(JSON.stringify(view.toJSON())).toContain('SYNTHETIC SPECIMEN');
  expect(mockSession.recoverPassport).toHaveBeenCalledWith('saved-workflow');
  expect(mockSession.readPassport).not.toHaveBeenCalled();
  expect(mockSession.startMRZ).not.toHaveBeenCalled();
  expect(mockSession.release).not.toHaveBeenCalled();
  await act(async () => { view.root.findByProps({testID: 'open-capture-flow'}).props.onPress(); });
  expect(view.root.findByProps({testID: 'passport-result'})).toBeDefined();
  await act(async () => { view.root.findByProps({label: 'Clear results'}).props.onPress(); });
  await act(async () => { await view.root.findAllByProps({label: 'Clear results'}).at(-1)!.props.onPress(); });
  expect(mockSession.eraseResults).toHaveBeenCalledTimes(1);
  expect(mockSession.release).toHaveBeenCalledTimes(1);
  expect(mockSession.eraseResults.mock.invocationCallOrder[0]).toBeLessThan(mockSession.release.mock.invocationCallOrder[0]);
  expect(JSON.stringify(view.toJSON())).not.toContain('SYNTHETIC SPECIMEN');
  await act(async () => { view.unmount(); });
});

test('a failed startup restore offers reopening and never silently starts a replacement', async () => {
  mockSession.listResults.mockRejectedValueOnce({code: 'resultIntegrityFailure'});
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<App configuration={durable} />); });
  expect(JSON.stringify(view.toJSON())).toContain('Saved results could not be opened');
  expect(view.root.findByProps({testID: 'open-capture-flow'}).props.disabled).toBe(true);
  expect(mockSession.readPassport).not.toHaveBeenCalled();
  expect(mockSession.eraseResults).not.toHaveBeenCalled();
  await act(async () => { view.root.findByProps({label: 'Reopen saved results'}).props.onPress(); });
  expect(JSON.stringify(view.toJSON())).toContain('SYNTHETIC SPECIMEN');
  await act(async () => { view.unmount(); });
});

test('saved checks stay reachable after selecting one result', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<App configuration={durable} />); });
  mockSession.listResults.mockResolvedValue([
    {kind: 'passport-read-v1', workflowID: 'first', artifacts: []},
    {kind: 'passport-read-v1', workflowID: 'second', artifacts: []},
  ]);
  await act(async () => { await view.root.findByProps({label: 'Open saved passport checks'}).props.onPress(); });
  expect(JSON.stringify(view.toJSON())).toContain('Saved passport checks');
  expect(view.root.findByProps({testID: 'saved-passport-0'})).toBeDefined();
  expect(view.root.findByProps({testID: 'saved-passport-1'})).toBeDefined();
  expect(mockSession.eraseResults).not.toHaveBeenCalled();
  expect(mockSession.startMRZ).not.toHaveBeenCalled();
  await act(async () => { view.unmount(); });
});
