import type { Configuration, DocumentCheckSnapshot, DocumentObservation } from '@kenshiki/identity-capture';
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
