import type { DocumentCheckSnapshot } from '@kenshiki/identity-capture';
import { TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, mockSession as makeSession, required } from '../testing/support';
import { DocumentCheckPanel } from './DocumentCheckPanel';
import { documentCustodyPresentation } from './DocumentCustodyPresentation';
import { Action } from '../ui/Action';

jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
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
test('correction entry stays native; React sends consent only and renders the safe outcome', async () => {
  const f = await setup();
  expect(f.native.documentCheck).not.toHaveBeenCalled();
  expect(f.native.documentCheckCorrect).not.toHaveBeenCalled();
  await f.press('Check record');
  expect(f.native.documentCheck).toHaveBeenCalledWith(true);
  await f.press('Review requested corrections');
  expect(f.native.documentCheckCorrect).toHaveBeenCalledWith(true, documentCustodyPresentation());
  expect(f.view.root.findAllByType(TextInput)).toHaveLength(0);
  const rendered = JSON.stringify(f.view.toJSON());
  expect(rendered).toContain('Issuing record matched');
  expect(rendered).not.toContain('SYNTHETIC');
  expect(rendered).not.toContain('Submit corrections');
  await act(async () => f.view.unmount());
});

test('dismissing native corrections retains requested-correction status without a new check', async () => {
  const f = await setup(correction);
  f.native.documentCheckCorrect.mockResolvedValueOnce(correction);
  await f.press('Review requested corrections');
  expect(f.native.documentCheckCorrect).toHaveBeenCalledTimes(1);
  expect(f.native.documentCheck).not.toHaveBeenCalled();
  expect(f.native.documentCheckAskAgain).not.toHaveBeenCalled();
  expect(f.view.root.findAllByType(TextInput)).toHaveLength(0);
  expect(f.view.root.findByProps({ label: 'Review requested corrections' })).toBeTruthy();
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
  expect(
    f.view.root.findAllByType(Action).filter((node) => node.props.testID === 'document-check-retake'),
  ).toHaveLength(1);
  await act(async () => {
    await invoke(f.view.root.findByProps({ testID: 'document-check-retake' }), 'onPress');
  });
  expect(retake).toHaveBeenCalledTimes(1);
  expect(f.native.documentCheck).not.toHaveBeenCalled();
  expect(f.native.documentCheckAskAgain).not.toHaveBeenCalled();
  await act(async () => f.view.unmount());
});
