import type {
  CaptureSession,
  Configuration,
  DocumentCheckSnapshot,
  DocumentObservation,
  PhoneCheckSnapshot,
} from '@kenshiki/identity-capture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { documentConfiguration, documentSessionMethods } from '../testing/documentFixture';
import { completedPhone, phoneConfiguration } from '../testing/phoneFixture';
import { invoke, mockSession, property, required, settle } from '../testing/support';
import App from '../app/App';
import { DriverLicenseFlow } from '../identity/DriverLicenseFlow';
import { IdentityLicenseFace } from './IdentityLicenseFace';
import { IdentityLicenseFlow } from './IdentityLicenseFlow';
import { PhoneFlow } from '../identity/PhoneFlow';
import * as PhoneControllers from '../identity/PhoneFlowController';
import { ControllerCustodyContext, createControllerCustody } from '../ui/ControllerCustody';
import { Page } from '../ui/Page';

const mockCreate = jest.fn<Promise<CaptureSession>, [Configuration]>();

jest.mock('../identity/DriverLicenseFlow', () => ({ DriverLicenseFlow: jest.fn(() => null) }));
jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCaptureSession: { create: (value: Configuration) => mockCreate(value) },
  IdentityCaptureImage: 'CaptureImage',
  IdentityCapturePreview: 'CapturePreview',
  IdentityDocumentInspection: 'DocumentInspection',
  IdentitySymbol: 'Symbol',
}));
const configuration = { document: documentConfiguration, phone: phoneConfiguration };
const ready: PhoneCheckSnapshot = { ...completedPhone, stage: 'start', receipt: null, recordedAt: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function phoneSession(snapshot = ready) {
  return mockSession({
    subscribe: jest.fn(() => () => {}),
    phoneSnapshot: jest.fn(async () => snapshot),
    phoneCancel: jest.fn(async () => snapshot),
    phoneSend: jest.fn(async () => ({ ...ready, stage: 'waiting' as const, pending: true, sent: true })),
    release: jest.fn(async () => {}),
  });
}
async function press(view: ReactTestRenderer, id: string) {
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
}
async function unmount(view: ReactTestRenderer) {
  await act(async () => {
    view.unmount();
    await settle();
  });
}
beforeEach(() => jest.clearAllMocks());

async function review() {
  const methods = documentSessionMethods();
  const old = await methods.documentResult();
  const document: DocumentObservation = { ...old, front: { ...required(old.front), captureID: 'new-front' } };
  const matched: DocumentCheckSnapshot = {
    ...(await methods.documentCheckRestore()),
    captureID: 'new-front',
  };
  const session = mockSession({
    ...methods,
    documentCheckRestore: jest.fn(async (): Promise<DocumentCheckSnapshot> => matched),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
  const next = jest.fn(() => true);
  const complete = jest.fn();
  const custody = createControllerCustody();
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <ControllerCustodyContext.Provider value={custody}>
        <IdentityLicenseFlow
          configuration={configuration}
          onComplete={complete}
          onExit={jest.fn()}
          onContinue={next}
        />
      </ControllerCustodyContext.Provider>,
    );
    await settle();
  });
  await act(async () => {
    invoke(view.root.findByType(DriverLicenseFlow), 'onComplete', { session, document });
    await settle();
  });
  return { view, session, document, matched, next, complete, custody };
}

test('Continue settles and revalidates the exact accepted operation before transferring once', async () => {
  const f = await review();
  const pending = deferred<void>();
  f.session.cancel.mockReturnValueOnce(pending.promise);
  let continuing: unknown;
  await act(async () => {
    const action = f.view.root.findByProps({ testID: 'onboarding-license-continue' });
    continuing = invoke(action, 'onPress');
    invoke(action, 'onPress');
    await settle();
  });
  expect(f.next).not.toHaveBeenCalled();
  expect(f.session.cancel).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve();
    await continuing;
  });
  expect(f.next).toHaveBeenCalledTimes(1);
  expect(f.next).toHaveBeenCalledWith({ session: f.session, document: f.document }, f.matched);
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.session.documentCheck).not.toHaveBeenCalled();
  expect(f.session.phoneSend).not.toHaveBeenCalled();
  await unmount(f.view);
  expect(f.session.release).not.toHaveBeenCalled();
});

test.each(['different operation', 'no longer matched', 'cancel failed', 'unmounted'] as const)(
  'Continue refuses %s without losing document ownership',
  async (reason) => {
    const f = await review();
    if (reason === 'different operation' || reason === 'no longer matched') {
      f.session.documentCheckRestore.mockResolvedValueOnce({
        ...f.matched,
        result: {
          ...required(f.matched.result),
          ...(reason === 'different operation'
            ? { operationID: 'replacement-operation' }
            : { outcome: 'recordNotMatched' as const }),
        },
      });
      await press(f.view, 'onboarding-license-continue');
    } else if (reason === 'cancel failed') {
      f.session.cancel.mockRejectedValueOnce(new Error('private-cancel-failure'));
      await press(f.view, 'onboarding-license-continue');
      expect(JSON.stringify(f.view.toJSON())).not.toContain('private-cancel-failure');
    } else {
      const pending = deferred<void>();
      f.session.cancel.mockReturnValueOnce(pending.promise);
      let continuing: unknown;
      await act(async () => {
        continuing = invoke(f.view.root.findByProps({ testID: 'onboarding-license-continue' }), 'onPress');
        await settle();
      });
      await unmount(f.view);
      await act(async () => {
        pending.resolve();
        await continuing;
      });
    }
    expect(f.next).not.toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
    if (reason !== 'unmounted') await unmount(f.view);
    await f.custody.releasing;
    expect(f.session.release).toHaveBeenCalledTimes(1);
  },
);

test('declined workspace handoff leaves document custody in review', async () => {
  const f = await review();
  f.next.mockReturnValue(false);
  await press(f.view, 'onboarding-license-continue');
  expect(f.next).toHaveBeenCalledTimes(1);
  expect(f.complete).not.toHaveBeenCalled();
  expect(f.session.release).not.toHaveBeenCalled();
  await unmount(f.view);
  await f.custody.releasing;
  expect(f.session.release).toHaveBeenCalledTimes(1);
});

test.each([ready, { ...ready, stage: 'waiting' as const, pending: true, sent: true }, completedPhone])(
  'guided phone stage $stage is passive and omits destructive controls',
  async (snapshot) => {
    const session = phoneSession(snapshot);
    const complete = jest.fn();
    const exit = jest.fn();
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(
        <PhoneFlow
          guided
          configuration={configuration}
          saved={{ session, snapshot }}
          onComplete={complete}
          onExit={exit}
        />,
      );
    });
    expect(view.root.findAllByProps({ testID: 'phone-erase' })).toHaveLength(0);
    expect(view.root.findAllByProps({ testID: 'onboarding-phone-confirmed' }).length > 0).toBe(
      snapshot.stage === 'completed',
    );
    expect(session.phoneSend).not.toHaveBeenCalled();
    expect(session.phoneResume).not.toHaveBeenCalled();
    expect(session.phoneStartOver).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    if (snapshot.stage === 'start') {
      await press(view, 'phone-send');
      expect(session.phoneSend).toHaveBeenCalledWith(true);
    }
    await unmount(view);
    expect(session.release).toHaveBeenCalledTimes(1);
  },
);

test.each([
  { ...completedPhone, pending: true },
  { ...completedPhone, busy: true },
  { ...completedPhone, failure: 'storageUnavailable' as const },
  {
    ...completedPhone,
    receipt: {
      ...required(completedPhone.receipt),
      subjectComparison: { status: 'contradicted' as const, checkedAt: '2026-10-11T12:00:00Z' },
    },
  },
])('retained phone receipt cannot confirm pending, busy, failed or contradictory work', async (snapshot) => {
  const session = phoneSession(snapshot);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <PhoneFlow
        guided
        configuration={configuration}
        saved={{ session, snapshot }}
        onComplete={jest.fn()}
        onExit={jest.fn()}
      />,
    );
  });
  expect(view.root.findAllByProps({ testID: 'onboarding-phone-confirmed' })).toHaveLength(0);
  expect(session.phoneSend).not.toHaveBeenCalled();
  await unmount(view);
});

test('unmount during guided phone cancellation cannot navigate from a late handoff', async () => {
  const session = phoneSession();
  const complete = jest.fn();
  const exit = jest.fn();
  const pending = deferred<PhoneCheckSnapshot>();
  session.phoneCancel.mockReturnValueOnce(pending.promise);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <PhoneFlow
        guided
        configuration={configuration}
        saved={{ session, snapshot: ready }}
        onComplete={complete}
        onExit={exit}
      />,
    );
  });
  let closing: unknown;
  await act(async () => {
    closing = invoke(view.root.findByType(Page), 'onClose');
    await settle();
  });
  await unmount(view);
  await act(async () => {
    pending.resolve(ready);
    await closing;
  });
  expect(complete).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
  expect(session.release).toHaveBeenCalledTimes(1);
});

test('real navigation replaces license review with guided phone and retains both native owners', async () => {
  const methods = documentSessionMethods();
  const old = await methods.documentResult();
  const document: DocumentObservation = { ...old, front: { ...required(old.front), captureID: 'new-front' } };
  const checked = { ...(await methods.documentCheckRestore()), captureID: 'new-front' };
  const documentSession = mockSession({
    ...methods,
    subscribe: jest.fn(() => () => {}),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
  documentSession.documentFaceSnapshot.mockResolvedValue({
    state: 'notStarted',
    captureID: required(document.front).captureID,
    sourceSHA256: required(document.front).sha256,
    documentOperationID: required(checked.result).operationID,
    result: null,
  });
  const phone = phoneSession(completedPhone);
  mockCreate.mockResolvedValueOnce(documentSession).mockResolvedValue(phone);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<App configuration={configuration} />);
    await settle();
  });
  expect(documentSession.release).not.toHaveBeenCalled();
  await press(view, 'open-identity-welcome');
  await press(view, 'onboarding-start');
  await press(view, 'choose-license');
  await press(view, 'onboarding-continue');
  await press(view, 'onboarding-capture');
  expect(documentSession.release).not.toHaveBeenCalled();
  await act(async () => {
    const leaf = view.root.findByType(DriverLicenseFlow);
    invoke(leaf, 'onClaim');
    documentSession.documentCheckRestore.mockResolvedValue(checked);
    invoke(leaf, 'onComplete', { session: documentSession, document });
    await settle();
  });
  expect(documentSession.release).not.toHaveBeenCalled();
  await press(view, 'onboarding-license-continue');
  expect(view.root.findAllByType(IdentityLicenseFlow)).toHaveLength(0);
  expect(property(view.root.findByType(PhoneFlow), 'guided')).toBe(true);
  expect(phone.phoneSend).not.toHaveBeenCalled();
  expect(phone.phoneResume).not.toHaveBeenCalled();
  expect(documentSession.release).not.toHaveBeenCalled();
  expect(phone.release).not.toHaveBeenCalled();
  await press(view, 'onboarding-phone-continue');
  expect(view.root.findAllByType(PhoneFlow)).toHaveLength(0);
  const face = view.root.findByType(IdentityLicenseFace);
  expect(property(face, 'saved')).toEqual({ session: documentSession, document });
  expect(property(face, 'documentOperationID')).toBe(checked.result?.operationID);
  expect(documentSession.documentFaceSnapshot).toHaveBeenCalledTimes(1);
  expect(documentSession.documentFacePrepare).not.toHaveBeenCalled();
  expect(documentSession.startSelfie).not.toHaveBeenCalled();
  expect(documentSession.release).not.toHaveBeenCalled();
  await unmount(view);
  expect(documentSession.release).toHaveBeenCalledTimes(1);
  expect(phone.release).toHaveBeenCalledTimes(1);
});

test.each(['replaced receipt', 'pending receipt', 'cancel rejected', 'workspace refused'] as const)(
  'phone Continue retains ownership when %s',
  async (reason) => {
    const session = phoneSession(completedPhone);
    const next = jest.fn(() => reason !== 'workspace refused');
    const complete = jest.fn();
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(
        <PhoneFlow
          guided
          configuration={configuration}
          saved={{ session, snapshot: completedPhone }}
          onContinue={next}
          onComplete={complete}
          onExit={jest.fn()}
        />,
      );
      await settle();
    });
    if (reason === 'replaced receipt')
      session.phoneSnapshot.mockResolvedValueOnce({
        ...completedPhone,
        receipt: { ...required(completedPhone.receipt), challengeID: 'different-challenge' },
      });
    if (reason === 'pending receipt')
      session.phoneSnapshot.mockResolvedValueOnce({ ...completedPhone, pending: true });
    if (reason === 'cancel rejected') session.phoneCancel.mockRejectedValueOnce({ code: 'busy' });
    await press(view, 'onboarding-phone-continue');
    expect(next).toHaveBeenCalledTimes(reason === 'workspace refused' ? 1 : 0);
    expect(complete).not.toHaveBeenCalled();
    expect(session.release).not.toHaveBeenCalled();
    expect(view.root.findAllByProps({ testID: 'phone-bottom-sheet' }).length).toBeGreaterThan(0);
    await unmount(view);
    expect(session.release).toHaveBeenCalledTimes(1);
  },
);

test('phone Continue drains once and cannot transfer after unmount', async () => {
  const session = phoneSession(completedPhone);
  const next = jest.fn(() => true);
  const cancelled = deferred<PhoneCheckSnapshot>();
  const custody = createControllerCustody();
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <ControllerCustodyContext.Provider value={custody}>
        <PhoneFlow
          guided
          configuration={configuration}
          saved={{ session, snapshot: completedPhone }}
          onContinue={next}
          onComplete={jest.fn()}
          onExit={jest.fn()}
        />
      </ControllerCustodyContext.Provider>,
    );
    await settle();
  });
  session.phoneCancel.mockReturnValueOnce(cancelled.promise);
  let advancing: unknown;
  await act(async () => {
    const action = view.root.findByProps({ testID: 'onboarding-phone-continue' });
    advancing = invoke(action, 'onPress');
    invoke(action, 'onPress');
    await settle();
  });
  expect(session.phoneCancel).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
  await unmount(view);
  await act(async () => {
    cancelled.resolve(completedPhone);
    await advancing;
  });
  await custody.releasing;
  expect(next).not.toHaveBeenCalled();
  expect(session.release).toHaveBeenCalledTimes(1);
});

test('accepted phone continuation can unmount before its awaiting screen resumes without releasing the new owner', async () => {
  const session = phoneSession(completedPhone);
  const complete = jest.fn();
  const exit = jest.fn();
  const custody = createControllerCustody();
  let view!: ReactTestRenderer;
  const next = jest.fn(() => true);
  const delivered = deferred<void>();
  const Controller = PhoneControllers.PhoneFlowController;
  const delivery = jest.spyOn(PhoneControllers, 'PhoneFlowController').mockImplementation((...args) => {
    const controller = new Controller(...args);
    const handoff = controller.handoff;
    controller.handoff = async (accept) => {
      const result = await handoff(accept);
      // Hold only delivery; the real controller has already transferred native ownership.
      await delivered.promise;
      return result;
    };
    return controller;
  });
  await act(async () => {
    view = create(
      <ControllerCustodyContext.Provider value={custody}>
        <PhoneFlow
          guided
          configuration={configuration}
          saved={{ session, snapshot: completedPhone }}
          onContinue={next}
          onComplete={complete}
          onExit={exit}
        />
      </ControllerCustodyContext.Provider>,
    );
    await settle();
  });
  let advancing: unknown;
  await act(async () => {
    advancing = invoke(view.root.findByProps({ testID: 'onboarding-phone-continue' }), 'onPress');
    await settle();
  });
  expect(next).toHaveBeenCalledTimes(1);
  await unmount(view);
  await act(async () => {
    delivered.resolve();
    await advancing;
  });
  delivery.mockRestore();
  await custody.releasing;
  expect(next).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledWith({ session, snapshot: completedPhone });
  expect(complete).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
  expect(session.release).not.toHaveBeenCalled();
  await session.release();
  expect(session.release).toHaveBeenCalledTimes(1);
});
