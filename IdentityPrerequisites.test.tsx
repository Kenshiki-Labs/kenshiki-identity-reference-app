import type { Configuration } from '@kenshiki/identity-capture';
import renderer, { act } from 'react-test-renderer';
import { completedPhone, phoneConfiguration } from './__tests__/phoneFixture';
import { mockSession, required } from './__tests__/support';
import { IdentityPrerequisiteGate } from './IdentityPrerequisiteGate';
import { ssnPrerequisite } from './IdentityPrerequisites';
import { createControllerCustody } from './ui/ControllerCustody';
import { type IdentityWorkspace, useIdentityWorkspace } from './useIdentityWorkspace';

jest.mock('@kenshiki/identity-capture', () => ({
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
  phone: phoneConfiguration,
  ssn: {
    providerID: 'synthetic',
    contextID: 'bound-context',
    directoryURL: 'file:///synthetic/ssn',
    keychainService: 'synthetic-ssn',
    keychainAccount: 'synthetic-ssn',
  },
};
test('SSN requires a document-bound phone service and a completed phone check', () => {
  expect(ssnPrerequisite({}, completedPhone)).toBe('document');
  expect(ssnPrerequisite(configuration, undefined)).toBe('phone');
  for (const patch of [
    { pending: true },
    { busy: true },
    { receipt: null },
    { failure: 'contextChanged' as const },
    { stage: 'waiting' as const },
    { stage: 'contradicted' as const },
  ])
    expect(ssnPrerequisite(configuration, { ...completedPhone, ...patch })).toBe('phone');
  expect(ssnPrerequisite({ phone: phoneConfiguration }, completedPhone)).toBe('service');
  expect(ssnPrerequisite(configuration, completedPhone)).toBeUndefined();
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
  const session = mockSession({ release: jest.fn(async () => {}) });
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
  expect(required(workspace).ssn.blocked).toBe('phone');
  await act(async () => {
    required(workspace).ssn.start();
  });
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => {
    required(workspace).phone.accept({ session, snapshot: completedPhone });
  });
  expect(required(workspace).ssn.blocked).toBeUndefined();
  await act(async () => {
    view.unmount();
  });
});
