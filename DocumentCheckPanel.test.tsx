import type { DocumentCheckSnapshot } from '@kenshiki/identity-capture';
import { TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, mockSession as makeSession, required } from './__tests__/support';
import { DocumentCheckPanel } from './DocumentCheckPanel';

jest.mock('@kenshiki/identity-capture', () => ({
  documentFieldReadout: jest.requireActual<
    typeof import('../../ReactNative/identity-capture/src/DocumentReadout')
  >('../../ReactNative/identity-capture/src/DocumentReadout').documentFieldReadout,
  isCaptureErrorCode: jest.requireActual<typeof import('../../ReactNative/identity-capture/src/codes')>(
    '../../ReactNative/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCaptureImage: 'Image',
  IdentityCapturePreview: 'Preview',
}));
const initial: DocumentCheckSnapshot = {
  captureID: 'capture',
  sourceSHA256: 'sha',
  state: 'notStarted',
  result: null,
  checkedAt: null,
  failure: null,
};
const correction: DocumentCheckSnapshot = {
  ...initial,
  state: 'checked',
  checkedAt: '2026-10-08T00:00:00Z',
  result: {
    outcome: 'needsCorrection',
    operationID: 'operation',
    providerStatus: 'needs-input',
    providerChecks: [],
    correctable: [{ field: 'givenName', code: 'required' }],
    replayed: false,
  },
};
async function setup(saved: DocumentCheckSnapshot = initial, onRetake?: () => void) {
  const native = {
    documentCheckRestore: jest.fn(async () => saved),
    documentCheck: jest.fn(async () => correction),
    documentCheckCorrect: jest.fn(
      async (): Promise<DocumentCheckSnapshot> => ({
        ...correction,
        result: {
          ...required(correction.result),
          outcome: 'recordMatched',
          providerStatus: 'answered',
          providerChecks: [
            {
              name: 'issuer',
              status: 'matched',
              reasons: ['name and date agreed'],
              metadataJSON: JSON.stringify({ 'name-first-match': 'full', risk: 0, flagged: false }),
            },
          ],
          receipt: {
            serviceVersion: 'test-contract-v1',
            answeredRequestSHA256: 'request-digest',
            observationSHA256: 'observation-digest',
          },
          submittedFields: { 'name-first': 'SYNTHETIC' },
          correctable: [],
        },
      }),
    ),
    documentCheckAskAgain: jest.fn(),
    cancel: jest.fn(async () => {}),
  };
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <DocumentCheckPanel session={makeSession(native)} configured {...(onRetake ? { onRetake } : {})} />,
    );
  });
  const press = async (label: string) =>
    act(async () => {
      const button = view.root.findByProps({ label });
      if (!button) throw new Error(`Missing button: ${label}`);
      invoke(button, 'onPress');
    });
  return { view, native, press };
}
test('reopening reads saved status without purchasing and corrections show the returned answer without raw provider keys', async () => {
  const f = await setup();
  expect(f.native.documentCheck).not.toHaveBeenCalled();
  await f.press('Check record');
  expect(f.native.documentCheck).toHaveBeenCalledWith(true);
  await f.press('Review requested corrections');
  expect(f.view.root.findByProps({ testID: 'document-check-bottom-sheet' })).toBeTruthy();
  await act(async () => {
    await invoke(f.view.root.findByType(TextInput), 'onChangeText', 'SYNTHETIC');
  });
  await f.press('Submit corrections');
  expect(f.native.documentCheckCorrect).toHaveBeenCalledWith({ givenName: 'SYNTHETIC' }, true);
  const rendered = JSON.stringify(f.view.toJSON());
  expect(rendered).toContain('Issuing record matched');
  expect(rendered).toContain('Issuing-state check results');
  expect(rendered).toContain('name and date agreed');
  expect(rendered).toContain('Full match');
  expect(rendered).toContain('test-contract-v1');
  expect(rendered).toContain('request-digest');
  expect(rendered).toContain('observation-digest');
  expect(rendered).toContain('Given name');
  expect(rendered).toContain('SYNTHETIC');
  expect(rendered).toContain('issuer');
  await act(async () => f.view.unmount());
});
test('provider errors offer local restore and never automatically repeat a check', async () => {
  const f = await setup();
  f.native.documentCheck.mockRejectedValueOnce({ code: 'unavailable' });
  await f.press('Check record');
  expect(f.view.root.findByProps({ testID: 'document-check-bottom-sheet' })).toBeTruthy();
  // A stale notStarted snapshot is not permission to submit after a rejected command.
  expect(f.view.root.findAllByProps({ testID: 'check-document-record' })).toHaveLength(0);
  await f.press('Reopen saved status');
  expect(f.native.documentCheck).toHaveBeenCalledTimes(1);
  expect(f.native.documentCheckRestore).toHaveBeenCalledTimes(2);
  await act(async () => f.view.unmount());
});

// A native reading failure must remain distinguishable from a service rejection.
// Rendering it must not retry a potentially paid check.
test.each([
  [
    'missingPreparedDocument',
    'The card image is not ready for checking. Try preparing the saved photo again; if it remains unavailable, retake the card.',
  ],
  ['analysisNotCompleted', 'The reader did not finish analyzing the prepared card image.'],
  [
    'fullPhotoAnalysisNotCompleted',
    'The reader read the prepared card image but did not finish analyzing the full photo.',
  ],
  [
    'observationsRejected',
    'The reader’s extracted details did not meet the checking service’s required format.',
  ],
  ['retentionFailed', 'The reader’s analysis could not be saved securely on this phone.'],
  ['engineUnavailable', 'The document reader could not start or finish its processing.'],
] as const)('shows the specific %s failure without dispatching another check', async (failure, message) => {
  const f = await setup();
  f.native.documentCheck.mockResolvedValueOnce({ ...initial, state: 'readerUnavailable', failure });
  await f.press('Check record');
  const rendered = JSON.stringify(f.view.toJSON());
  expect(rendered).toContain(message);
  expect(rendered).not.toContain('The document reader could not complete this check.');
  expect(f.native.documentCheck).toHaveBeenCalledTimes(1);
  expect(f.native.documentCheckAskAgain).not.toHaveBeenCalled();
  await act(async () => f.view.unmount());
});

test('a pre-dispatch request rejection offers local recovery without silently dispatching again', async () => {
  const f = await setup({ ...initial, state: 'unavailable', failure: 'requestRejected' });
  expect(f.view.root.findAllByProps({ testID: 'document-check-recover' })).not.toHaveLength(0);
  expect(f.view.root.findAllByProps({ testID: 'check-document-record' })).toHaveLength(0);
  await act(async () => {
    await invoke(f.view.root.findByProps({ testID: 'document-check-recover' }), 'onPress');
  });
  expect(f.native.documentCheckRestore).toHaveBeenCalledTimes(2);
  expect(f.native.documentCheck).not.toHaveBeenCalled();
  await act(async () => f.view.unmount());
});

test('an uncertain dispatched request recovers its journal before offering only the saved request replay', async () => {
  const f = await setup({ ...initial, state: 'unavailable', failure: 'serviceUnavailable' });
  f.native.documentCheckRestore.mockResolvedValueOnce({ ...initial, state: 'unanswered' });
  await act(async () => {
    await invoke(f.view.root.findByProps({ testID: 'document-check-recover' }), 'onPress');
  });
  expect(f.view.root.findAllByProps({ testID: 'check-document-record' })).toHaveLength(0);
  await act(async () => {
    await invoke(f.view.root.findByProps({ testID: 'document-check-ask-again' }), 'onPress');
  });
  expect(f.native.documentCheckAskAgain).toHaveBeenCalledWith(true);
  expect(f.native.documentCheck).not.toHaveBeenCalled();
  await act(async () => f.view.unmount());
});

test('an unreadable photo exposes the capture owner callback without invoking a provider', async () => {
  const retake = jest.fn();
  const f = await setup({ ...initial, state: 'unreadable' }, retake);
  await act(async () => {
    await invoke(f.view.root.findByProps({ testID: 'document-check-retake' }), 'onPress');
  });
  expect(retake).toHaveBeenCalledTimes(1);
  expect(f.native.documentCheck).not.toHaveBeenCalled();
  expect(f.native.documentCheckAskAgain).not.toHaveBeenCalled();
  await act(async () => f.view.unmount());
});

// Use the same wire vocabulary as WorkerDocumentChecker's plan.aamva projection,
// not UI-invented camelCase keys that could conceal a broken production label map.
test('submitted document fields retain their meaning in the production wire vocabulary', async () => {
  const fields = {
    'name-first': 'ALEX',
    'name-middle': 'R',
    'name-last': 'EXAMPLE',
    birthdate: '1990-01-02',
    'identification-number': 'SYNTHETIC000001',
    'expiration-date': '2030-12-31',
    'issue-date': '2020-01-02',
    'address-street-1': '100 EXAMPLE WAY',
    'address-street-2': 'UNIT 2',
    'address-city': 'SAMPLE CITY',
    'address-subdivision': 'OR',
    'address-postal-code': '97001',
    'issuing-authority': 'OR',
    'country-code': 'US',
    'future-field': 'extension',
  };
  const f = await setup({
    ...correction,
    result: { ...required(correction.result), submittedFields: fields },
  });
  const rendered = JSON.stringify(f.view.toJSON());
  for (const label of [
    'Given name',
    'Family name',
    'Middle name',
    'Date of birth',
    'Document number',
    'Expiry date',
    'Issue date',
    'Street address',
    'Address line 2',
    'City',
    'State',
    'Postal code',
    'Issuing state',
    'Country',
    'Field future-field',
  ])
    expect(rendered).toContain(label);
  expect(rendered).not.toContain('Other detail');
  for (const value of Object.values(fields)) expect(rendered).toContain(value);
  await act(async () => f.view.unmount());
});
