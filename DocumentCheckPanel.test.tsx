import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {TextInput} from 'react-native';
import {DocumentCheckPanel} from './DocumentCheckPanel';
import {IdentitySheetHost} from './IdentitySheetHost';
import type {IdentityCaptureSession} from '@kenshiki/identity-capture';
jest.mock('@kenshiki/identity-capture', () => ({IdentityCaptureImage: 'Image', IdentityCapturePreview: 'Preview'}));
const initial = {captureID: 'capture', sourceSHA256: 'sha', state: 'notStarted', result: null, checkedAt: null, failure: null};
const correction = {...initial, state: 'checked', checkedAt: '2026-10-08T00:00:00Z', result: {
  outcome: 'needsCorrection', operationID: 'operation', providerStatus: 'needs-input', providerChecks: [],
  correctable: [{field: 'givenName', code: 'required'}], replayed: false,
}};
async function setup() {
  const native = {documentCheckRestore: jest.fn(async () => initial),
    documentCheck: jest.fn(async () => correction), documentCheckCorrect: jest.fn(async () => ({...correction,
      result: {...correction.result, outcome: 'recordMatched', providerStatus: 'answered',
        providerChecks: [{name: 'issuer', status: 'matched', reasons: ['name and date agreed'],
          metadataJSON: JSON.stringify({'name-first-match': 'full', risk: 0, flagged: false})}],
        receipt: {serviceVersion: 'test-contract-v1', answeredRequestSHA256: 'request-digest', observationSHA256: 'observation-digest'},
        submittedFields: {givenName: 'SYNTHETIC'}, correctable: []}})),
    documentCheckAskAgain: jest.fn(), cancel: jest.fn(async () => {})};
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<IdentitySheetHost><DocumentCheckPanel
    session={native as unknown as IdentityCaptureSession} configured /></IdentitySheetHost>); });
  const press = async (label: string) => act(async () => {
    const button = view.root.findByProps({label});
    if (!button) throw new Error('Missing button: ' + label);
    button.props.onPress();
  });
  return {view, native, press};
}
test('reopening reads saved status without purchasing and corrections show the returned answer without raw provider keys', async () => {
  const f = await setup(); expect(f.native.documentCheck).not.toHaveBeenCalled();
  await f.press('Check license record'); expect(f.native.documentCheck).toHaveBeenCalledWith(true);
  await f.press('Review requested corrections');
  expect(f.view.root.findByProps({testID: 'document-check-bottom-sheet'})).toBeTruthy();
  await act(async () => f.view.root.findByType(TextInput).props.onChangeText('SYNTHETIC'));
  await f.press('Submit corrections');
  expect(f.native.documentCheckCorrect).toHaveBeenCalledWith({givenName: 'SYNTHETIC'}, true);
  const rendered = JSON.stringify(f.view.toJSON());
  expect(rendered).toContain('Issuing record matched'); expect(rendered).toContain('The checking service returned 1 individual check.');
  expect(rendered).toContain('test-contract-v1');
  expect(rendered).toContain('request-digest'); expect(rendered).toContain('observation-digest');
  expect(rendered).toContain('Given name'); expect(rendered).toContain('SYNTHETIC');
  for (const raw of ['name and date agreed', 'name-first-match', 'issuer', '"answered"']) expect(rendered).not.toContain(raw);
  await act(async () => f.view.unmount());
});
test('provider errors offer local restore and never automatically repeat a check', async () => {
  const f = await setup(); f.native.documentCheck.mockRejectedValueOnce({code: 'unavailable'});
  await f.press('Check license record');
  expect(f.view.root.findByProps({testID: 'document-check-bottom-sheet'})).toBeTruthy();
  await f.press('Reopen saved status');
  expect(f.native.documentCheck).toHaveBeenCalledTimes(1); expect(f.native.documentCheckRestore).toHaveBeenCalledTimes(2);
  await act(async () => f.view.unmount());
});
