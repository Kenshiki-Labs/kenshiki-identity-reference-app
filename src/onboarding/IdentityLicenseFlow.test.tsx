import type { DocumentCheckSnapshot, DocumentObservation } from '@kenshiki/identity-capture';
import { TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { documentConfiguration } from '../testing/documentFixture';
import { invoke, mockSession, property, required, settle, without } from '../testing/support';
import { documentCustodyPresentation } from '../identity/DocumentCustodyPresentation';
import type { SavedDocumentCapture } from '../identity/DocumentFlowController';
import { DriverLicenseFlow } from '../identity/DriverLicenseFlow';
import { IdentityLicenseFlow } from './IdentityLicenseFlow';
import { Action } from '../ui/Action';
import { ControllerCustodyContext, type IdentityCustody } from '../ui/ControllerCustody';
import { Page } from '../ui/Page';

jest.mock('../identity/DriverLicenseFlow', () => ({ DriverLicenseFlow: jest.fn(() => null) }));
jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCaptureImage: 'CaptureImage',
  IdentityDocumentInspection: 'DocumentInspection',
  IdentitySymbol: 'Symbol',
}));
const front = {
  captureID: 'new-front',
  sha256: 'a'.repeat(64),
  side: 'front' as const,
  pdf417Status: 'notRequested' as const,
  sideCorrespondence: null,
};
const document: DocumentObservation = {
  workflowID: 'new-workflow',
  front,
  back: { ...front, captureID: 'new-back', side: 'back', sha256: 'b'.repeat(64) },
};
const initial: DocumentCheckSnapshot = {
  captureID: front.captureID,
  sourceSHA256: front.sha256,
  state: 'notStarted',
  result: null,
  checkedAt: null,
  failure: null,
};
const matched: DocumentCheckSnapshot = {
  ...initial,
  state: 'checked',
  checkedAt: '2026-10-11T12:00:00Z',
  result: { outcome: 'recordMatched', operationID: 'operation', replayed: false },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function setup(snapshot = initial, oldDocument?: DocumentObservation, configured = true) {
  const session = mockSession({
    documentCheckRestore: jest.fn(async (): Promise<DocumentCheckSnapshot> => snapshot),
    documentCheck: jest.fn(async (): Promise<DocumentCheckSnapshot> => matched),
    documentCheckCorrect: jest.fn(async (): Promise<DocumentCheckSnapshot> => matched),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
  const saved = oldDocument ? { session, document: oldDocument } : undefined;
  const complete = jest.fn();
  const exit = jest.fn();
  const claim = jest.fn();
  const custody: IdentityCustody = { releasing: Promise.resolve(), reportFailure: jest.fn() };
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <ControllerCustodyContext.Provider value={custody}>
        <IdentityLicenseFlow
          configuration={{
            document: configured ? documentConfiguration : without(documentConfiguration, 'check'),
          }}
          saved={saved}
          resume="front"
          onComplete={complete}
          onExit={exit}
          onClaim={claim}
        />
      </ControllerCustodyContext.Provider>,
    );
  });
  const handoff = async (value: DocumentObservation = document) => {
    await act(async () => {
      invoke(view.root.findByType(DriverLicenseFlow), 'onComplete', { session, document: value });
      await settle();
    });
  };
  const press = async (id: string) => {
    await act(async () => {
      await invoke(
        required(
          view.root
            .findAllByProps({ testID: id })
            .filter((node) => typeof property(node, 'onPress') === 'function')
            .at(-1),
        ),
        'onPress',
      );
    });
  };
  const close = async () => {
    await act(async () => {
      await invoke(view.root.findByType(Page), 'onClose');
    });
  };
  const unmount = async () => {
    await act(async () => {
      view.unmount();
      await settle();
    });
  };
  const detailsDisabled = () =>
    property(
      required(
        view.root
          .findAllByType(Action)
          .find((node) => property(node, 'testID') === 'document-native-details'),
      ),
      'disabled',
    );
  const accepted = () => view.root.findAllByProps({ testID: 'onboarding-license-accepted' }).length > 0;
  return {
    view,
    session,
    complete,
    exit,
    custody,
    saved,
    handoff,
    press,
    close,
    unmount,
    accepted,
    detailsDisabled,
  };
}

test('a newly captured pair restores locally and dispatches only on explicit check', async () => {
  const f = await setup();
  await f.handoff();
  expect(f.view.root.findAllByProps({ testID: 'onboarding-license-review' }).length).toBeGreaterThan(0);
  expect(f.session.documentCheckRestore).toHaveBeenCalledTimes(1);
  expect(f.session.documentCheck).not.toHaveBeenCalled();
  expect(f.session.documentCheckAskAgain).not.toHaveBeenCalled();
  expect(f.session.documentCheckCorrect).not.toHaveBeenCalled();
  expect(f.accepted()).toBe(false);
  await f.press('check-document-record');
  expect(f.session.documentCheck).toHaveBeenCalledWith(true);
  expect(f.accepted()).toBe(true);
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.session.phoneSend).not.toHaveBeenCalled();
  await f.unmount();
});

test.each(['partial', 'unchanged front'] as const)(
  '%s returns custody without review or provider work',
  async (kind) => {
    const value = kind === 'partial' ? { ...document, back: null } : document;
    const f = await setup(initial, kind === 'unchanged front' ? document : undefined);
    await f.handoff(value);
    expect(f.complete).toHaveBeenCalledWith({ session: f.session, document: value });
    expect(f.view.root.findAllByProps({ testID: 'onboarding-license-review' })).toHaveLength(0);
    expect(f.session.documentCheckRestore).not.toHaveBeenCalled();
    expect(f.session.documentCheck).not.toHaveBeenCalled();
    await f.unmount();
    expect(f.session.release).not.toHaveBeenCalled();
  },
);

test.each(['recordNotMatched', 'pending', 'unavailable', 'needsCorrection', 'inconclusive'] as const)(
  '%s is never accepted',
  async (outcome) => {
    const f = await setup({ ...matched, result: { ...required(matched.result), outcome } });
    await f.handoff();
    expect(f.accepted()).toBe(false);
    expect(f.session.documentCheck).not.toHaveBeenCalled();
    await f.unmount();
  },
);
test.each([
  ['wrong capture', { ...matched, captureID: 'old-front' }],
  ['wrong digest', { ...matched, sourceSHA256: 'c'.repeat(64) }],
  ['missing operation', { ...matched, result: { ...required(matched.result), operationID: '' } }],
  ['incomplete state', { ...matched, state: 'unanswered' as const }],
  ['failure', { ...matched, failure: 'serviceUnavailable' as const }],
] as const)('%s cannot turn a saved match into acceptance', async (_label, snapshot) => {
  const f = await setup(snapshot);
  await f.handoff();
  expect(f.accepted()).toBe(false);
  await f.unmount();
});

test('native corrections reuse the shared consent-only path', async () => {
  const f = await setup({ ...matched, result: { ...required(matched.result), outcome: 'needsCorrection' } });
  await f.handoff();
  await act(async () => {
    await invoke(f.view.root.findByProps({ label: 'Review requested corrections' }), 'onPress');
  });
  expect(f.session.documentCheckCorrect).toHaveBeenCalledWith(true, documentCustodyPresentation());
  expect(f.session.documentCheck).not.toHaveBeenCalled();
  expect(f.view.root.findAllByType(TextInput)).toHaveLength(0);
  expect(f.accepted()).toBe(true);
  await f.unmount();
});

test('close waits for native cancellation and deduplicates repeated back', async () => {
  const f = await setup();
  await f.handoff();
  const pending = deferred<void>();
  f.session.cancel.mockReturnValueOnce(pending.promise);
  let closing!: unknown;
  await act(async () => {
    closing = invoke(f.view.root.findByType(Page), 'onClose');
    invoke(f.view.root.findByType(Page), 'onClose');
    await settle();
  });
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.session.cancel).toHaveBeenCalledTimes(1);
  expect(f.detailsDisabled()).toBe(true);
  await act(async () => {
    pending.resolve();
    await closing;
  });
  expect(f.complete).toHaveBeenCalledTimes(1);
  expect(f.complete).toHaveBeenCalledWith({ session: f.session, document });
  await f.unmount();
  expect(f.session.release).not.toHaveBeenCalled();
});

test('failed cancellation keeps review custody and permits a deliberate retry', async () => {
  const f = await setup();
  await f.handoff();
  f.session.cancel.mockRejectedValueOnce(new Error('SYNTHETIC PRIVATE ERROR'));
  await f.close();
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.session.release).not.toHaveBeenCalled();
  expect(JSON.stringify(f.view.toJSON())).not.toContain('SYNTHETIC PRIVATE ERROR');
  expect(f.view.root.findAllByProps({ testID: 'onboarding-license-review' }).length).toBeGreaterThan(0);
  await f.close();
  expect(f.complete).toHaveBeenCalledTimes(1);
  await f.unmount();
});

test('retake hands the same owned session back to the existing capture flow', async () => {
  const f = await setup();
  await f.handoff();
  await f.press('onboarding-license-retake');
  const capture = f.view.root.findByType(DriverLicenseFlow);
  expect(property(capture, 'saved')).toEqual({ session: f.session, document });
  expect(property(capture, 'resume')).toBe('front');
  expect(f.session.release).not.toHaveBeenCalled();
  // Cancelling the replacement must return the old pair, never falsely review it as new.
  await f.handoff(document);
  expect(f.complete).toHaveBeenCalledWith({ session: f.session, document });
  expect(f.session.documentCheckRestore).toHaveBeenCalledTimes(2);
  await f.unmount();
});

test('unmount releases review ownership through the custody barrier and ignores late check success', async () => {
  const f = await setup();
  await f.handoff();
  const check = deferred<DocumentCheckSnapshot>();
  const release = deferred<void>();
  f.session.documentCheck.mockReturnValueOnce(check.promise);
  f.session.release.mockReturnValueOnce(release.promise);
  await act(async () => {
    invoke(f.view.root.findByProps({ testID: 'check-document-record' }), 'onPress');
    await settle();
  });
  await f.unmount();
  let settled = false;
  const barrier = f.custody.releasing.then(() => {
    settled = true;
  });
  await settle();
  expect(settled).toBe(false);
  await act(async () => {
    check.resolve(matched);
    release.resolve();
    await barrier;
  });
  expect(f.session.release).toHaveBeenCalledTimes(1);
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.exit).not.toHaveBeenCalled();
});

test('late capture completion after unmount cannot navigate or start checking', async () => {
  const f = await setup();
  const completion = property(f.view.root.findByType(DriverLicenseFlow), 'onComplete');
  function isCompletion(value: unknown): value is (saved: SavedDocumentCapture) => void {
    return typeof value === 'function';
  }
  if (!isCompletion(completion)) throw new Error('Missing capture completion');
  await f.unmount();
  await act(async () => {
    completion({ session: f.session, document });
    await settle();
  });
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.session.documentCheckRestore).not.toHaveBeenCalled();
  expect(f.session.documentCheck).not.toHaveBeenCalled();
});

test('a pending restore hides a previous acceptance and a rejected restore does not resurrect it', async () => {
  const f = await setup(matched);
  await f.handoff();
  expect(f.accepted()).toBe(true);
  const pending = deferred<DocumentCheckSnapshot>();
  f.session.documentCheckRestore.mockReturnValueOnce(pending.promise);
  await act(async () => {
    invoke(f.view.root.findByProps({ testID: 'document-check-reopen' }), 'onPress');
    await settle();
  });
  expect(f.accepted()).toBe(false);
  expect(f.detailsDisabled()).toBe(true);
  await act(async () => {
    pending.reject(new Error('synthetic restore failure'));
    await settle();
  });
  expect(f.accepted()).toBe(false);
  expect(f.session.documentCheck).not.toHaveBeenCalled();
  await f.unmount();
});

test('unmount during close prevents late completion from navigating and releases ownership once', async () => {
  const f = await setup();
  await f.handoff();
  const pending = deferred<void>();
  f.session.cancel.mockReturnValueOnce(pending.promise);
  let closing!: unknown;
  await act(async () => {
    closing = invoke(f.view.root.findByType(Page), 'onClose');
    await settle();
  });
  await f.unmount();
  const restoredBeforeCompletion = f.session.documentCheckRestore.mock.calls.length;
  await act(async () => {
    pending.resolve();
    await closing;
    await settle();
  });
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.exit).not.toHaveBeenCalled();
  expect(f.session.documentCheckRestore).toHaveBeenCalledTimes(restoredBeforeCompletion);
  expect(f.session.release).toHaveBeenCalledTimes(1);
});

test('an unconfigured review never restores or dispatches and still settles on Back', async () => {
  const f = await setup(initial, undefined, false);
  await f.handoff();
  expect(f.session.documentCheckRestore).not.toHaveBeenCalled();
  expect(f.session.documentCheck).not.toHaveBeenCalled();
  expect(f.accepted()).toBe(false);
  await f.close();
  expect(f.session.cancel).toHaveBeenCalledTimes(1);
  expect(f.complete).toHaveBeenCalledWith({ session: f.session, document });
  await f.unmount();
  expect(f.session.release).not.toHaveBeenCalled();
});

test('failed owner release rejects shared custody so a successor cannot acquire silently', async () => {
  const f = await setup();
  await f.handoff();
  const failure = new Error('synthetic release failure');
  f.session.release.mockRejectedValueOnce(failure);
  await f.unmount();
  await expect(f.custody.releasing).rejects.toBe(failure);
  expect(f.custody.reportFailure).toHaveBeenCalledWith(failure);
  expect(f.complete).not.toHaveBeenCalled();
});
