import {
  type CaptureSession,
  type Configuration,
  type DocumentCheckSnapshot,
  type DocumentObservation,
  IdentityCaptureSession,
  type PassportObservation,
  type PhoneCheckSnapshot,
} from '@kenshiki/identity-capture';
import renderer, { act } from 'react-test-renderer';
import { completedPhone, phoneConfiguration } from './__tests__/phoneFixture';
import { mockSession, required } from './__tests__/support';
import { IdentityPrerequisiteGate } from './IdentityPrerequisiteGate';
import { phonePrerequisite, ssnPrerequisite } from './IdentityPrerequisites';
import { createControllerCustody } from './ui/ControllerCustody';
import { type IdentityWorkspace, useIdentityWorkspace } from './useIdentityWorkspace';

jest.mock('@kenshiki/identity-capture', () => ({
  documentFieldReadout: jest.requireActual<
    typeof import('../../ReactNative/identity-capture/src/DocumentReadout')
  >('../../ReactNative/identity-capture/src/DocumentReadout').documentFieldReadout,
  IdentityCaptureSession: {
    create: jest.fn(() => {
      throw new Error('Unexpected native session');
    }),
  },
  isCaptureErrorCode: jest.requireActual<typeof import('../../ReactNative/identity-capture/src/codes')>(
    '../../ReactNative/identity-capture/src/codes',
  ).isCaptureErrorCode,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: 'SafeAreaProvider',
  SafeAreaView: 'SafeAreaView',
}));

const configuration: Configuration = {
  document: {
    directoryURL: 'file:///synthetic/documents',
    keychainService: 'documents',
    keychainAccount: 'evidence',
    requiresLocation: false,
    check: { providerID: 'synthetic-document', recordDomain: 'synthetic' },
  },
  phone: phoneConfiguration,
  ssn: {
    providerID: 'synthetic',
    contextID: 'bound-context',
    directoryURL: 'file:///synthetic/ssn',
    keychainService: 'synthetic-ssn',
    keychainAccount: 'synthetic-ssn',
  },
};
const document: DocumentObservation = {
  workflowID: 'document',
  back: null,
  front: {
    captureID: 'front',
    sha256: 'a'.repeat(64),
    side: 'front',
    pdf417: null,
    pdf417Status: 'notRequested',
    sideCorrespondence: null,
  },
};
const checked: DocumentCheckSnapshot = {
  captureID: 'front',
  sourceSHA256: 'a'.repeat(64),
  state: 'checked',
  failure: null,
  checkedAt: '2026-10-10T12:00:00Z',
  result: {
    operationID: '00000000-0000-4000-8000-000000000003',
    outcome: 'recordMatched',
    providerChecks: [],
    correctable: [],
    replayed: false,
  },
};
test('phone requires an accepted native check bound to the current original', () => {
  expect(phonePrerequisite(configuration, undefined, checked)).toBe('document');
  expect(phonePrerequisite(configuration, document, undefined)).toBe('document');
  for (const patch of [
    { captureID: 'another-capture' },
    { sourceSHA256: 'b'.repeat(64) },
    { state: 'unanswered' as const },
    { failure: 'replyRejected' as const },
    { result: null },
    { result: { ...required(checked.result), outcome: 'recordNotMatched' as const } },
  ])
    expect(phonePrerequisite(configuration, document, { ...checked, ...patch })).toBe('document');
  expect(phonePrerequisite(configuration, document, checked)).toBeUndefined();
});
test('SSN requires a document-bound phone service and a completed phone check', () => {
  expect(ssnPrerequisite({}, completedPhone)).toBe('document');
  expect(ssnPrerequisite(configuration, undefined, true)).toBe('phone');
  for (const patch of [
    { pending: true },
    { busy: true },
    { receipt: null },
    { failure: 'contextChanged' as const },
    { stage: 'waiting' as const },
    { stage: 'contradicted' as const },
  ])
    expect(ssnPrerequisite(configuration, { ...completedPhone, ...patch }, true)).toBe('phone');
  expect(ssnPrerequisite({ phone: phoneConfiguration }, completedPhone, true)).toBe('service');
  expect(ssnPrerequisite(configuration, completedPhone, true)).toBeUndefined();
});
test('direct navigation never mounts a blocked service flow', async () => {
  const mounted = jest.fn();
  function Service() {
    mounted();
    return null;
  }
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(
      <IdentityPrerequisiteGate reason="phone" onExit={() => {}}>
        <Service />
      </IdentityPrerequisiteGate>,
    );
  });
  expect(mounted).not.toHaveBeenCalled();
  expect(JSON.stringify(view.toJSON())).toContain('Complete the phone check');
  await act(async () => {
    view.update(
      <IdentityPrerequisiteGate reason={undefined} onExit={() => {}}>
        <Service />
      </IdentityPrerequisiteGate>,
    );
  });
  expect(mounted).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.unmount();
  });
});

test('replacing document evidence revokes SSN navigation until phone is revalidated', async () => {
  const custody = createControllerCustody();
  const navigate = jest.fn();
  const home = jest.fn();
  let workspace: IdentityWorkspace | undefined;
  function Harness() {
    workspace = useIdentityWorkspace(configuration, home, navigate, custody);
    return null;
  }
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<Harness />);
  });
  const session = mockSession({
    release: jest.fn(async () => {}),
    documentCheckRestore: jest.fn(async () => checked),
  });
  await act(async () => {
    required(workspace).license.accept({ session, document });
  });
  await act(async () => {
    required(workspace).phone.accept({ session, snapshot: completedPhone });
  });
  expect(required(workspace).ssn.blocked).toBeUndefined();
  await act(async () => {
    required(workspace).license.accept({
      session,
      document: {
        workflowID: 'new-document',
        back: null,
        front: {
          captureID: 'new-front',
          sha256: 'b'.repeat(64),
          side: 'front',
          pdf417: null,
          pdf417Status: 'notRequested',
          sideCorrespondence: null,
        },
      },
    });
  });
  expect(required(workspace).ssn.blocked).toBe('document');
  await act(async () => {
    required(workspace).ssn.start();
  });
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => {
    required(workspace).phone.accept({ session, snapshot: completedPhone });
  });
  expect(required(workspace).ssn.blocked).toBe('document');
  await act(async () => {
    required(workspace).license.accept({ session, document });
  });
  expect(required(workspace).ssn.blocked).toBe('phone');
  await act(async () => {
    required(workspace).phone.accept({ session, snapshot: completedPhone });
  });
  expect(required(workspace).ssn.blocked).toBeUndefined();
  await act(async () => {
    view.unmount();
  });
});

test('configured phone cannot navigate before an accepted native document check', async () => {
  const custody = createControllerCustody();
  const navigate = jest.fn();
  let workspace: IdentityWorkspace | undefined;
  function Harness() {
    workspace = useIdentityWorkspace(configuration, () => {}, navigate, custody);
    return null;
  }
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<Harness />);
  });
  await act(async () => {
    required(workspace).phone.start();
  });
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});

test('newer document-check state supersedes a late restore and requires phone revalidation', async () => {
  let resolve!: (snapshot: DocumentCheckSnapshot) => void;
  const restored = new Promise<DocumentCheckSnapshot>((done) => {
    resolve = done;
  });
  const session = mockSession({
    release: jest.fn(async () => {}),
    documentCheckRestore: jest.fn(() => restored),
  });
  const custody = createControllerCustody();
  let workspace: IdentityWorkspace | undefined;
  function Harness() {
    workspace = useIdentityWorkspace(
      configuration,
      () => {},
      () => {},
      custody,
    );
    return null;
  }
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<Harness />);
  });
  await act(async () => {
    required(workspace).license.accept({ session, document });
  });
  expect(required(workspace).phone.blocked).toBe('document');
  await act(async () => {
    required(workspace).license.checkChanged(session, {
      busy: false,
      loaded: true,
      failure: undefined,
      snapshot: checked,
    });
  });
  expect(required(workspace).phone.blocked).toBeUndefined();
  await act(async () => {
    required(workspace).phone.accept({ session, snapshot: completedPhone });
  });
  expect(required(workspace).ssn.blocked).toBeUndefined();
  await act(async () => {
    required(workspace).license.checkChanged(session, {
      busy: false,
      loaded: true,
      failure: undefined,
      snapshot: { ...checked, result: { ...required(checked.result), operationID: 'new-operation' } },
    });
    resolve({ ...checked, result: { ...required(checked.result), outcome: 'recordNotMatched' } });
  });
  expect(required(workspace).phone.blocked).toBeUndefined();
  expect(required(workspace).ssn.blocked).toBe('phone');
  await act(async () => {
    required(workspace).license.checkChanged(session, {
      busy: true,
      loaded: true,
      failure: undefined,
      snapshot: checked,
    });
  });
  expect(required(workspace).phone.blocked).toBe('document');
  await act(async () => {
    view.unmount();
  });
});

test('relaunch restores the SDK selection and its exact accepted check without opening the license picker', async () => {
  const session = mockSession({
    subscribe: jest.fn(() => () => {}),
    restoreDocumentSelection: jest.fn(async () => document),
    documentResult: jest.fn(async () => document),
    documentCheckRestore: jest.fn(async () => checked),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
  const createSession: (configuration: Configuration) => Promise<CaptureSession> =
    IdentityCaptureSession.create;
  jest.mocked(createSession).mockResolvedValueOnce(session);
  const custody = createControllerCustody();
  const navigate = jest.fn();
  let workspace: IdentityWorkspace | undefined;
  function Harness() {
    workspace = useIdentityWorkspace(configuration, () => {}, navigate, custody);
    return null;
  }
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<Harness />);
  });
  expect(required(workspace).phone.blocked).toBeUndefined();
  expect(required(workspace).phone.configuration.phone?.checkedDocumentID).toBe('front');
  expect(session.listDocuments).not.toHaveBeenCalled();
  expect(session.documentCheck).not.toHaveBeenCalled();
  expect(session.phoneSend).not.toHaveBeenCalled();
  expect(session.release).not.toHaveBeenCalled();
  await act(async () => {
    required(workspace).phone.start();
  });
  expect(navigate).toHaveBeenCalledWith('phone');
  await act(async () => {
    view.unmount();
  });
  expect(session.release).toHaveBeenCalledTimes(1);
});

async function restoredPhoneFixture(read: () => Promise<PhoneCheckSnapshot>) {
  const documentSession = mockSession({
    subscribe: jest.fn(() => () => {}),
    restoreDocumentSelection: jest.fn(async () => document),
    documentResult: jest.fn(async () => document),
    documentCheckRestore: jest.fn(async () => checked),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
  const phoneSession = mockSession({
    subscribe: jest.fn(() => () => {}),
    phoneSnapshot: jest.fn(read),
    phoneCancel: jest.fn(async () => completedPhone),
    release: jest.fn(async () => {}),
  });
  const createSession: (configuration: Configuration) => Promise<CaptureSession> =
    IdentityCaptureSession.create;
  jest.mocked(createSession).mockResolvedValueOnce(documentSession).mockResolvedValueOnce(phoneSession);
  const custody = createControllerCustody();
  const navigate = jest.fn();
  let workspace: IdentityWorkspace | undefined;
  function Harness() {
    workspace = useIdentityWorkspace(configuration, () => {}, navigate, custody);
    return null;
  }
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<Harness />);
  });
  return { view, phoneSession, documentSession, navigate, workspace: () => required(workspace) };
}

test('cold launch restores the completed phone receipt and enables SSN without visiting Phone', async () => {
  const { view, phoneSession, documentSession, navigate, workspace } = await restoredPhoneFixture(
    async () => completedPhone,
  );
  expect(workspace().phone.result?.snapshot.receipt).toEqual(completedPhone.receipt);
  expect(workspace().ssn.blocked).toBeUndefined();
  expect(workspace().passport.openingResults).toBe(false);
  expect(phoneSession.phoneSend).not.toHaveBeenCalled();
  expect(phoneSession.phoneResume).not.toHaveBeenCalled();
  expect(documentSession.documentCheck).not.toHaveBeenCalled();
  await act(async () => {
    workspace().ssn.start();
  });
  expect(navigate).toHaveBeenCalledWith('ssn');
  await act(async () => {
    view.unmount();
  });
  expect(phoneSession.release).toHaveBeenCalledTimes(1);
  expect(documentSession.release).toHaveBeenCalledTimes(1);
});

test('a retained receipt with a pending attempt does not unlock SSN or resume a provider call', async () => {
  const pending = { ...completedPhone, pending: true, stage: 'waiting' as const };
  const { view, workspace, phoneSession, navigate } = await restoredPhoneFixture(async () => pending);
  expect(workspace().ssn.blocked).toBe('phone');
  await act(async () => {
    workspace().ssn.start();
  });
  expect(navigate).not.toHaveBeenCalled();
  expect(phoneSession.phoneSend).not.toHaveBeenCalled();
  expect(phoneSession.phoneResume).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});

test('a delayed phone restore keeps startup gated and releases its session when the holder leaves', async () => {
  let resolve!: (snapshot: PhoneCheckSnapshot) => void;
  const delayed = new Promise<PhoneCheckSnapshot>((done) => {
    resolve = done;
  });
  const { view, workspace, phoneSession, navigate } = await restoredPhoneFixture(() => delayed);
  expect(workspace().passport.openingResults).toBe(true);
  await act(async () => {
    workspace().ssn.start();
  });
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
    resolve(completedPhone);
  });
  expect(phoneSession.release).toHaveBeenCalledTimes(1);
  expect(phoneSession.phoneSend).not.toHaveBeenCalled();
});

const savedPassport: PassportObservation = {
  protocolVerdicts: { source: 'recorded', recordedAt: '2026-10-11T12:00:00Z' },
  documentNumber: 'SYNTHETIC',
  birthDateYYMMDD: '850615',
  expiryDateYYMMDD: '320101',
  surname: 'SPECIMEN',
  givenNames: 'SYNTHETIC',
  nationality: 'UTO',
  issuingState: 'UTO',
  sex: 'F',
  portraitAvailable: false,
  portraitSHA256: '',
  personalNumber: null,
  dateOfIssue: null,
  issuingAuthority: null,
  placeOfBirth: null,
  correspondence: { documentNumber: 'matches' },
  protocols: {
    basicAccessControl: 'succeeded',
    pace: 'notPerformed',
    activeAuthentication: 'notPerformed',
    chipAuthentication: 'notPerformed',
    countrySigningChain: 'succeeded',
    documentSignature: 'succeeded',
    dataGroupHashes: 'succeeded',
  },
};
function retrySession() {
  return mockSession({
    subscribe: jest.fn(() => () => {}),
    listResults: jest.fn(async () => [
      {
        id: 'saved-passport',
        revision: 1,
        recordedAt: '2026-10-11T12:00:00Z',
        kind: 'passport-read-v1' as const,
        workflowID: 'saved-passport',
        artifacts: [],
      },
    ]),
    recoverPassport: jest.fn(async () => savedPassport),
    restoreDocumentSelection: jest.fn(async () => document),
    documentResult: jest.fn(async () => document),
    documentCheckRestore: jest.fn(async () => checked),
    phoneSnapshot: jest.fn(async () => completedPhone),
    phoneCancel: jest.fn(async () => completedPhone),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
}
function expectReadOnly(sessions: ReturnType<typeof retrySession>[]) {
  for (const session of sessions) {
    expect(session.documentCheck).not.toHaveBeenCalled();
    expect(session.phoneSend).not.toHaveBeenCalled();
    expect(session.phoneResume).not.toHaveBeenCalled();
    expect(session.readPassport).not.toHaveBeenCalled();
  }
}

test('partial restore retry retains the existing passport and releases every distinct owner once', async () => {
  const sessions: ReturnType<typeof retrySession>[] = [];
  const create: (configuration: Configuration) => Promise<CaptureSession> = IdentityCaptureSession.create;
  const createSession = jest.mocked(create);
  createSession.mockImplementation(async () => {
    const session = retrySession();
    sessions.push(session);
    if (sessions.length === 2)
      session.restoreDocumentSelection.mockRejectedValueOnce({ code: 'storageUnavailable' });
    return session;
  });
  const config: Configuration = {
    document: required(configuration.document),
    results: { directoryURL: 'file:///results', keychainService: 'results', keychainAccount: 'results' },
  };
  const custody = createControllerCustody();
  let workspace: IdentityWorkspace | undefined;
  function Harness() {
    workspace = useIdentityWorkspace(
      config,
      () => {},
      () => {},
      custody,
    );
    return null;
  }
  let view!: renderer.ReactTestRenderer;
  try {
    await act(async () => {
      view = renderer.create(<Harness />);
    });
    expect(required(workspace).passport.result?.session).toBe(sessions[0]);
    expect(required(workspace).recovery.restoreFailure).toBeDefined();
    await act(async () => required(workspace).recovery.retryRestore());
    expect(required(workspace).recovery.restoreFailure).toBeUndefined();
    expect(required(workspace).passport.result?.session).toBe(sessions[0]);
    expect(sessions).toHaveLength(3);
    expect(required(workspace).license.result?.session).toBe(sessions[2]);
    expectReadOnly(sessions);
  } finally {
    await act(async () => view.unmount());
    createSession.mockReset();
  }
  for (const session of sessions) expect(session.release).toHaveBeenCalledTimes(1);
});

test('partial restore retry resumes the retained document check and restores phone without provider work', async () => {
  const documentSession = retrySession();
  documentSession.documentCheckRestore.mockRejectedValue({ code: 'storageUnavailable' });
  const phoneSession = retrySession();
  const create: (configuration: Configuration) => Promise<CaptureSession> = IdentityCaptureSession.create;
  const createSession = jest.mocked(create);
  createSession.mockResolvedValueOnce(documentSession).mockResolvedValueOnce(phoneSession);
  const custody = createControllerCustody();
  let workspace: IdentityWorkspace | undefined;
  function Harness() {
    workspace = useIdentityWorkspace(
      configuration,
      () => {},
      () => {},
      custody,
    );
    return null;
  }
  let view!: renderer.ReactTestRenderer;
  try {
    await act(async () => {
      view = renderer.create(<Harness />);
    });
    expect(required(workspace).license.result?.session).toBe(documentSession);
    expect(required(workspace).recovery.restoreFailure).toBeDefined();
    expect(required(workspace).ssn.blocked).toBe('document');
    const previousReads = documentSession.documentCheckRestore.mock.calls.length;
    documentSession.documentCheckRestore.mockResolvedValue(checked);
    await act(async () => required(workspace).recovery.retryRestore());
    expect(documentSession.documentCheckRestore).toHaveBeenCalledTimes(previousReads + 1);
    expect(documentSession.restoreDocumentSelection).toHaveBeenCalledTimes(1);
    expect(required(workspace).license.result?.session).toBe(documentSession);
    expect(required(workspace).phone.result?.session).toBe(phoneSession);
    expect(required(workspace).ssn.blocked).toBeUndefined();
    expect(required(workspace).recovery.restoreFailure).toBeUndefined();
    expectReadOnly([documentSession, phoneSession]);
  } finally {
    await act(async () => view.unmount());
    createSession.mockReset();
  }
  expect(documentSession.release).toHaveBeenCalledTimes(1);
  expect(phoneSession.release).toHaveBeenCalledTimes(1);
});

test('unreadable phone receipt remains a restore error and retry reuses the document without provider work', async () => {
  const { view, workspace, documentSession, phoneSession } = await restoredPhoneFixture(async () => {
    throw { code: 'storageUnavailable' };
  });
  const replacementPhone = retrySession();
  const create: (configuration: Configuration) => Promise<CaptureSession> = IdentityCaptureSession.create;
  const createSession = jest.mocked(create);
  createSession.mockResolvedValueOnce(replacementPhone);
  try {
    expect(workspace().passport.openingResults).toBe(false);
    expect(workspace().recovery.restoreFailure).toBeDefined();
    expect(workspace().ssn.blocked).toBe('phone');
    expect(phoneSession.release).toHaveBeenCalledTimes(1);
    const failure = workspace().recovery.restoreFailure;
    await act(async () => {
      workspace().license.checkChanged(documentSession, {
        busy: false,
        loaded: true,
        failure: undefined,
        snapshot: checked,
      });
    });
    expect(workspace().recovery.restoreFailure).toBe(failure);
    const previousReads = documentSession.documentCheckRestore.mock.calls.length;
    await act(async () => workspace().recovery.retryRestore());
    expect(documentSession.documentCheckRestore).toHaveBeenCalledTimes(previousReads + 1);
    expect(documentSession.restoreDocumentSelection).toHaveBeenCalledTimes(1);
    expect(workspace().license.result?.session).toBe(documentSession);
    expect(workspace().phone.result?.session).toBe(replacementPhone);
    expect(workspace().ssn.blocked).toBeUndefined();
    expect(workspace().recovery.restoreFailure).toBeUndefined();
    for (const session of [documentSession, phoneSession, replacementPhone]) {
      expect(session.documentCheck).not.toHaveBeenCalled();
      expect(session.phoneSend).not.toHaveBeenCalled();
      expect(session.phoneResume).not.toHaveBeenCalled();
    }
  } finally {
    await act(async () => view.unmount());
    createSession.mockReset();
  }
  expect(documentSession.release).toHaveBeenCalledTimes(1);
  expect(phoneSession.release).toHaveBeenCalledTimes(1);
  expect(replacementPhone.release).toHaveBeenCalledTimes(1);
});
