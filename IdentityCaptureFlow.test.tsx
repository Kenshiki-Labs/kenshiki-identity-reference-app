import React from 'react';
import renderer, {act} from 'react-test-renderer';
import type {CaptureEvent, PassportObservation} from '@kenshiki/identity-capture';
import App from './App';

let mockEvent: (event: CaptureEvent) => void;
const mockPassport: PassportObservation = {
  documentNumber: 'X1234567', birthDateYYMMDD: '850615', expiryDateYYMMDD: '320101',
  surname: 'SPECIMEN', givenNames: 'SYNTHETIC', nationality: 'UTO', issuingState: 'UTO', sex: 'F',
  portraitAvailable: true, portraitSHA256: 'reference', personalNumber: null, dateOfIssue: null,
  issuingAuthority: null, placeOfBirth: null, correspondence: {documentNumber: 'matches'},
  protocols: {basicAccessControl: 'succeeded', pace: 'notPerformed', activeAuthentication: 'notPerformed',
    chipAuthentication: 'notPerformed', countrySigningChain: 'succeeded', documentSignature: 'succeeded', dataGroupHashes: 'succeeded'},
};
const mockMRZ = {...mockPassport, completeness: 'complete' as const, missingFields: [], normalizedLines: []};
const mockSession = {
  id: 'test', subscribe: jest.fn(listener => { mockEvent = listener; return jest.fn(); }),
  startMRZ: jest.fn(async () => {}), captureMRZ: jest.fn(async () => mockMRZ),
  readPassport: jest.fn(async () => mockPassport), cancel: jest.fn(async () => {}), release: jest.fn(async () => {}),
};
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: {create: jest.fn(async () => mockSession)},
  IdentityCapturePreview: 'MockCapturePreview', IdentityCaptureImage: 'MockCaptureImage',
}));

test('passport completion returns to cards and results reopen without repeating capture or deleting evidence', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => { view = renderer.create(<App />); });
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
