import type { DocumentCheckSnapshot } from '@kenshiki/identity-capture';
import { TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, mockSession as makeSession, required } from './__tests__/support';
import { DocumentCheckPanel } from './DocumentCheckPanel';

jest.mock('@kenshiki/identity-capture', () => ({
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
async function setup() {
  const native = {
    documentCheckRestore: jest.fn(async () => initial),
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
          submittedFields: { givenName: 'SYNTHETIC' },
          correctable: [],
        },
      }),
    ),
    documentCheckAskAgain: jest.fn(),
    cancel: jest.fn(async () => {}),
  };
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<DocumentCheckPanel session={makeSession(native)} configured />);
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
  await f.press('Check license record');
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
  expect(rendered).toContain('The checking service returned 1 individual check.');
  expect(rendered).toContain('test-contract-v1');
  expect(rendered).toContain('request-digest');
  expect(rendered).toContain('observation-digest');
  expect(rendered).toContain('Given name');
  expect(rendered).toContain('SYNTHETIC');
  for (const raw of ['name and date agreed', 'name-first-match', 'issuer', '"answered"'])
    expect(rendered).not.toContain(raw);
  await act(async () => f.view.unmount());
});
test('provider errors offer local restore and never automatically repeat a check', async () => {
  const f = await setup();
  f.native.documentCheck.mockRejectedValueOnce({ code: 'unavailable' });
  await f.press('Check license record');
  expect(f.view.root.findByProps({ testID: 'document-check-bottom-sheet' })).toBeTruthy();
  await f.press('Reopen saved status');
  expect(f.native.documentCheck).toHaveBeenCalledTimes(1);
  expect(f.native.documentCheckRestore).toHaveBeenCalledTimes(2);
  await act(async () => f.view.unmount());
});
