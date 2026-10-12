import type { CaptureSession, Configuration, PassportObservation } from '@kenshiki/identity-capture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { documentConfiguration, documentSessionMethods } from '../testing/documentFixture';
import { completedPhone, phoneConfiguration } from '../testing/phoneFixture';
import { mockSession, required } from '../testing/support';
import type { IdentityCustody } from '../ui/ControllerCustody';
import { type IdentityWorkspace, useIdentityWorkspace } from './useIdentityWorkspace';

type Flow = 'passport' | 'document' | 'phone';
const mockCreate = jest.fn<Promise<CaptureSession>, [Configuration]>();
let mockFlow: Flow;
let mockGate: Promise<void>;
let mockTransferred = false;
/** Delay only delivery of an actual successful handoff. The real controller has relinquished
 * ownership, but the workspace has not adopted it; unmount here must release that exact session. */
async function mockDeliver<T>(flow: Flow, handoff: () => Promise<T>): Promise<T> {
  const saved = await handoff();
  if (flow === mockFlow) {
    mockTransferred = true;
    await mockGate;
  }
  return saved;
}
jest.mock('../identity/CaptureFlowController', () => {
  const actual = jest.requireActual<typeof import('../identity/CaptureFlowController')>('../identity/CaptureFlowController');
  return {
    ...actual,
    CaptureFlowController: class extends actual.CaptureFlowController {
      constructor(...args: ConstructorParameters<typeof actual.CaptureFlowController>) {
        super(...args);
        const handoff = this.handoff;
        this.handoff = () => mockDeliver('passport', handoff);
      }
    },
  };
});
jest.mock('../identity/DocumentFlowController', () => {
  const actual = jest.requireActual<typeof import('../identity/DocumentFlowController')>('../identity/DocumentFlowController');
  return {
    ...actual,
    DocumentFlowController: class extends actual.DocumentFlowController {
      constructor(...args: ConstructorParameters<typeof actual.DocumentFlowController>) {
        super(...args);
        const handoff = this.handoff;
        this.handoff = () => mockDeliver('document', handoff);
      }
    },
  };
});
jest.mock('../identity/PhoneFlowController', () => {
  const actual = jest.requireActual<typeof import('../identity/PhoneFlowController')>('../identity/PhoneFlowController');
  return {
    ...actual,
    PhoneFlowController: class extends actual.PhoneFlowController {
      constructor(...args: ConstructorParameters<typeof actual.PhoneFlowController>) {
        super(...args);
        const handoff = this.handoff;
        this.handoff = () => mockDeliver('phone', handoff);
      }
    },
  };
});
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: { create: (configuration: Configuration) => mockCreate(configuration) },
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
}));
const passport: PassportObservation = {
  documentNumber: 'SYNTHETIC',
  birthDateYYMMDD: '850615',
  expiryDateYYMMDD: '320101',
  surname: 'SPECIMEN',
  givenNames: 'RESTORE',
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
  protocolVerdicts: { source: 'recorded', recordedAt: '2026-10-11T12:00:00Z' },
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
const results: NonNullable<Configuration['results']> = {
  directoryURL: 'file:///handoff-results',
  keychainService: 'handoff-results',
  keychainAccount: 'evidence',
};
function nativeSession(id: string) {
  return mockSession({
    ...documentSessionMethods(),
    id,
    subscribe: jest.fn(() => jest.fn()),
    listResults: jest.fn(async () => [
      {
        id: 'saved',
        revision: 1,
        recordedAt: '2026-10-11T12:00:00Z',
        kind: 'passport-read-v1' as const,
        workflowID: 'saved',
        artifacts: [],
      },
    ]),
    recoverPassport: jest.fn(async () => passport),
    phoneSnapshot: jest.fn(async () => completedPhone),
    phoneCancel: jest.fn(async () => completedPhone),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
}

describe.each<Flow>(['passport', 'document', 'phone'])('%s restore handoff', (flow) => {
  test.each([false, true])(
    'successor waits for transferred release after unmount (rejects: %s)',
    async (fails) => {
      mockCreate.mockReset();
      mockFlow = flow;
      mockTransferred = false;
      let deliver!: () => void;
      mockGate = new Promise<void>((resolve) => {
        deliver = resolve;
      });
      let release!: () => void;
      let rejectRelease!: (error: unknown) => void;
      const released = new Promise<void>((resolve, reject) => {
        release = resolve;
        rejectRelease = reject;
      });
      const sessions: ReturnType<typeof nativeSession>[] = [];
      mockCreate.mockImplementation(async () => {
        const session = nativeSession(`owner-${sessions.length}`);
        sessions.push(session);
        return session;
      });
      const configuration: Configuration =
        flow === 'passport'
          ? { results }
          : {
              document: documentConfiguration,
              ...(flow === 'phone' ? { phone: phoneConfiguration } : {}),
            };
      const custody: IdentityCustody = { releasing: Promise.resolve(), reportFailure: jest.fn() };
      const home = jest.fn();
      const navigate = jest.fn();
      let workspace: IdentityWorkspace | undefined;
      function Harness({ config }: { config: Configuration }) {
        workspace = useIdentityWorkspace(config, home, navigate, custody);
        return null;
      }
      let view: ReactTestRenderer | undefined;
      try {
        await act(async () => {
          view = create(<Harness config={configuration} />);
        });
        expect(mockTransferred).toBe(true);
        expect(required(workspace).passport.openingResults).toBe(true);
        const transferred = required(sessions.at(-1));
        transferred.release.mockImplementation(() => released);
        expect(transferred.release).not.toHaveBeenCalled();
        await act(async () => required(view).unmount());
        view = undefined;
        expect(transferred.release).not.toHaveBeenCalled();
        const successor = nativeSession('successor');
        successor.listResults.mockResolvedValue([]);
        mockCreate.mockResolvedValueOnce(successor);
        const previousAcquisitions = mockCreate.mock.calls.length;
        await act(async () => {
          view = create(<Harness config={{ results }} />);
        });
        expect(mockCreate).toHaveBeenCalledTimes(previousAcquisitions);
        await act(async () => deliver());
        expect(transferred.release).toHaveBeenCalledTimes(1);
        expect(mockCreate).toHaveBeenCalledTimes(previousAcquisitions);
        const failure = new Error('Transferred session release failed');
        await act(async () => {
          if (fails) rejectRelease(failure);
          else release();
        });
        if (fails) {
          await expect(custody.releasing).rejects.toBe(failure);
          expect(custody.reportFailure).toHaveBeenCalledWith(failure);
          expect(mockCreate).toHaveBeenCalledTimes(previousAcquisitions);
          expect(required(workspace).recovery.restoreFailure).toBeDefined();
        } else {
          await expect(custody.releasing).resolves.toBeDefined();
          expect(mockCreate).toHaveBeenCalledTimes(previousAcquisitions + 1);
          expect(successor.listResults).toHaveBeenCalledTimes(1);
        }
        expect(home).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
        for (const session of sessions) {
          expect(session.release).toHaveBeenCalledTimes(1);
          expect(session.phoneSend).not.toHaveBeenCalled();
          expect(session.phoneResume).not.toHaveBeenCalled();
          expect(session.documentCheck).not.toHaveBeenCalled();
          expect(session.readPassport).not.toHaveBeenCalled();
        }
      } finally {
        await act(async () => {
          deliver();
          release();
          view?.unmount();
        });
      }
    },
  );
});
