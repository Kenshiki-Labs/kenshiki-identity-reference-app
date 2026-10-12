import type {
  CaptureEvent,
  CaptureSession,
  Configuration,
  DocumentCheckSnapshot,
  DocumentFaceSnapshot,
  DocumentObservation,
  EnvironmentCheckSnapshot,
  PhoneCheckSnapshot,
  SSNSessionSnapshot,
} from '@kenshiki/identity-capture';
import { AppState } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { documentConfiguration } from '../testing/documentFixture';
import { completedPhone, phoneConfiguration } from '../testing/phoneFixture';
import { ssnBinding, ssnCompletedSnapshot } from '../testing/ssnFixture';
import { invoke, mockSession, nativeBack, property, required, settle } from '../testing/support';
import App from '../app/App';
import { Page } from '../ui/Page';

const mockCreate = jest.fn<Promise<CaptureSession>, [Configuration]>();
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: { create: (configuration: Configuration) => mockCreate(configuration) },
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCapturePreview: 'NativePreview',
  IdentityCaptureImage: 'NativeImage',
  IdentityDocumentInspection: 'NativeInspection',
  IdentitySymbol: 'Symbol',
  IdentitySensorSymbol: 'SensorSymbol',
  IdentitySensorMap: 'SensorMap',
}));
const front = {
  captureID: 'front',
  sha256: 'a'.repeat(64),
  side: 'front' as const,
  pdf417Status: 'notRequested' as const,
  sideCorrespondence: null,
};
const document: DocumentObservation = {
  workflowID: 'workflow',
  front,
  back: { ...front, captureID: 'back', sha256: 'b'.repeat(64), side: 'back' },
};
const unchecked: DocumentCheckSnapshot = {
  captureID: front.captureID,
  sourceSHA256: front.sha256,
  state: 'notStarted',
  result: null,
  checkedAt: null,
  failure: null,
};
const matched: DocumentCheckSnapshot = {
  ...unchecked,
  state: 'checked',
  result: { outcome: 'recordMatched', operationID: ssnBinding.documentOperationID, replayed: false },
  checkedAt: '2026-10-11T12:00:00Z',
};
const faceInitial: DocumentFaceSnapshot = {
  captureID: front.captureID,
  sourceSHA256: front.sha256,
  documentOperationID: ssnBinding.documentOperationID,
  state: 'notStarted',
  result: null,
};
const facePass: DocumentFaceSnapshot = {
  ...faceInitial,
  state: 'completed',
  result: { outcome: 'pass', completedAt: '2026-10-11T12:01:00Z' },
};
const phoneReady: PhoneCheckSnapshot = { ...completedPhone, stage: 'start', receipt: null, recordedAt: null };
const phoneComplete: PhoneCheckSnapshot = {
  ...completedPhone,
  receipt: { ...required(completedPhone.receipt), challengeID: ssnBinding.phoneChallengeID },
};
const ssnReady: SSNSessionSnapshot = {
  state: 'ready',
  receipt: null,
  attempt: null,
  failure: null,
  recoveryNeeded: false,
  busy: false,
};
const environmentIdle: EnvironmentCheckSnapshot = {
  state: 'idle',
  attemptID: null,
  checkedAt: null,
  location: 'notChecked',
  air: 'notChecked',
  reason: null,
  permissions: { location: 'given', motion: 'given' },
};
const environmentComplete: EnvironmentCheckSnapshot = {
  ...environmentIdle,
  state: 'completed',
  attemptID: '55555555-5555-4555-8555-555555555555',
  checkedAt: '2026-10-11T12:05:00Z',
  location: 'observed',
  air: 'consistent',
};
const configuration: Configuration = {
  document: documentConfiguration,
  phone: phoneConfiguration,
  ssn: {
    contextID: 'holder',
    providerID: 'ssn',
    directoryURL: 'file:///ssn',
    keychainService: 'ssn',
    keychainAccount: 'ssn',
  },
};
let view: ReactTestRenderer | undefined;
async function fixture() {
  let docListener: ((event: CaptureEvent) => void) | undefined;
  let phoneListener: ((event: CaptureEvent) => void) | undefined;
  let observation: DocumentObservation = { workflowID: document.workflowID, front: null, back: null };
  let checked = unchecked;
  let face = faceInitial;
  let phone = phoneReady;
  let ssn = ssnReady;
  let environment = environmentIdle;
  let side: 'front' | 'back' = 'front';
  const restored = mockSession({
    restoreDocumentSelection: jest.fn(async () => null),
    release: jest.fn(async () => {}),
  });
  const license = mockSession({
    subscribe: jest.fn((receive) => {
      docListener = receive;
      return () => {
        docListener = undefined;
      };
    }),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
    startDocument: jest.fn(async (options) => {
      side = options.side;
    }),
    captureDocument: jest.fn(async () => {
      observation = side === 'front' ? { ...document, back: null } : document;
      docListener?.({ type: 'documentCaptured', observation });
    }),
    documentResult: jest.fn(async () => observation),
    documentCheckRestore: jest.fn(async () => checked),
    documentDetails: jest.fn(async () => {}),
    documentCheck: jest.fn(async () => {
      checked = matched;
      return checked;
    }),
    documentFaceSnapshot: jest.fn(async () => face),
    documentFacePrepare: jest.fn(async () => faceInitial),
    startSelfie: jest.fn(async () => {}),
    captureSelfie: jest.fn(async () => {
      docListener?.({ type: 'documentSelfieCaptured' });
    }),
    documentFaceCompare: jest.fn(async () => {
      face = facePass;
      return face;
    }),
  });
  const phoneSession = mockSession({
    subscribe: jest.fn((receive) => {
      phoneListener = receive;
      return () => {
        phoneListener = undefined;
      };
    }),
    phoneSnapshot: jest.fn(async () => phone),
    phoneDetails: jest.fn(async () => {}),
    phoneCancel: jest.fn(async () => phone),
    release: jest.fn(async () => {}),
    phoneSend: jest.fn(async () => {
      phone = { ...phoneReady, stage: 'waiting', pending: true, sent: true, challengeReserved: true };
      return phone;
    }),
  });
  const ssnSession = mockSession({
    ssnSnapshot: jest.fn(async () => ssn),
    ssnDetails: jest.fn(async () => ssn),
    ssnCancel: jest.fn(async () => ssn),
    release: jest.fn(async () => {}),
    cancel: jest.fn(async () => {}),
    ssnEntry: jest.fn(async () => {
      ssn = ssnCompletedSnapshot;
      return ssn;
    }),
    environmentSnapshot: jest.fn(async () => environment),
    environmentCheck: jest.fn(async () => {
      environment = environmentComplete;
      return environment;
    }),
  });
  mockCreate
    .mockResolvedValueOnce(restored)
    .mockResolvedValueOnce(license)
    .mockResolvedValueOnce(phoneSession)
    .mockResolvedValueOnce(ssnSession);
  await act(async () => {
    view = create(<App configuration={configuration} />);
    await settle();
  });
  const shown = (id: string) => required(view).root.findAllByProps({ testID: id }).length > 0;
  const tap = async (id: string) => {
    if (!shown(id)) throw new Error(`Missing ${id}: ${JSON.stringify(required(view).toJSON())}`);
    await act(async () => {
      await invoke(
        required(
          required(view)
            .root.findAllByProps({ testID: id })
            .filter((node) => typeof property(node, 'onPress') === 'function')
            .at(-1),
        ),
        'onPress',
      );
      await settle();
    });
  };
  const emit = async (event: CaptureEvent) => {
    await act(async () => {
      required(docListener)(event);
      await settle();
    });
  };
  const capture = async (captureSide: 'front' | 'back') => {
    await emit({ type: 'documentProgress', side: captureSide, phase: 'capturing', ready: true, issue: null });
    await tap('capture-document');
  };
  const toReview = async () => {
    await tap('open-identity-welcome');
    await tap('onboarding-start');
    await tap('choose-license');
    await tap('onboarding-continue');
    await tap('onboarding-capture');
    await capture('front');
    await tap('start-document-back');
    await capture('back');
    expect(shown('onboarding-license-review')).toBe(true);
  };
  const toPhone = async () => {
    await toReview();
    expect(license.documentCheck).not.toHaveBeenCalled();
    await tap('check-document-record');
    await tap('onboarding-license-continue');
  };
  const toFace = async () => {
    await toPhone();
    expect(phoneSession.phoneSend).not.toHaveBeenCalled();
    await tap('phone-send');
    await act(async () => {
      phone = phoneComplete;
      required(phoneListener)({ type: 'phoneSnapshot', snapshot: phone });
      await settle();
    });
    await tap('onboarding-phone-continue');
  };
  const toSSN = async () => {
    await toFace();
    expect(license.startSelfie).not.toHaveBeenCalled();
    await tap('onboarding-face-start');
    await emit({ type: 'selfieReadiness', permitsCapture: true, reason: null, blinkPhase: 'reopened' });
    await tap('onboarding-face-capture');
    await tap('onboarding-face-continue');
  };
  const toEnvironment = async () => {
    await toSSN();
    expect(ssnSession.ssnEntry).not.toHaveBeenCalled();
    await tap('ssn-begin-entry');
    await tap('onboarding-ssn-continue');
  };
  return {
    license,
    phoneSession,
    ssnSession,
    restored,
    tap,
    shown,
    toReview,
    toPhone,
    toFace,
    toSSN,
    toEnvironment,
    setCheck: (value: DocumentCheckSnapshot) => {
      checked = value;
    },
    setSSN: (value: SSNSessionSnapshot) => {
      ssn = value;
    },
    setFace: (value: DocumentFaceSnapshot) => {
      face = value;
    },
    setPhone: (value: PhoneCheckSnapshot) => {
      phone = value;
    },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
  jest.useFakeTimers();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(async () => {
  await act(async () => {
    view?.unmount();
    await settle();
  });
  view = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('real App completes license front/back, explicit check, phone, license face, native SSN and combined environment in order', async () => {
  const f = await fixture();
  await f.toEnvironment();
  expect(f.ssnSession.environmentCheck).not.toHaveBeenCalled();
  await f.tap('onboarding-environment-run');
  await f.tap('onboarding-environment-finish');
  expect(f.shown('onboarding-verification-result')).toBe(true);
  expect(f.license.startDocument.mock.calls.map(([options]) => options.side)).toEqual(['front', 'back']);
  expect(f.license.captureDocument).toHaveBeenCalledTimes(2);
  expect(f.license.documentCheck).toHaveBeenCalledTimes(1);
  expect(f.phoneSession.phoneSend).toHaveBeenCalledTimes(1);
  expect(f.license.documentFacePrepare).toHaveBeenCalledWith(true);
  expect(f.license.documentFaceCompare).toHaveBeenCalledTimes(1);
  expect(f.license.compareFace).not.toHaveBeenCalled();
  expect(f.ssnSession.ssnEntry).toHaveBeenCalledTimes(1);
  expect(f.ssnSession.environmentCheck).toHaveBeenCalledWith(true);
  expect(mockCreate).toHaveBeenCalledTimes(4);
  expect(f.license.release).not.toHaveBeenCalled();
  expect(f.phoneSession.release).not.toHaveBeenCalled();
  expect(f.ssnSession.release).not.toHaveBeenCalled();
  await f.tap('onboarding-verification-close');
  expect(f.shown('onboarding-verification-result')).toBe(false);
  expect(f.shown('identity-hub')).toBe(true);
  expect(f.shown('identity-preparation')).toBe(false);
  expect(f.shown('identity-choose-id')).toBe(false);
  expect(f.shown('identity-welcome')).toBe(false);
});
test('record mismatch cannot advance from review or dispatch phone', async () => {
  const f = await fixture();
  await f.toReview();
  f.license.documentCheck.mockResolvedValueOnce({
    ...matched,
    result: { outcome: 'recordNotMatched', operationID: ssnBinding.documentOperationID, replayed: false },
  });
  await f.tap('check-document-record');
  expect(f.shown('onboarding-license-continue')).toBe(false);
  expect(f.phoneSession.phoneSend).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledTimes(2);
});
test('stale SSN binding cannot leave SSN or initiate the final environment check', async () => {
  const f = await fixture();
  await f.toSSN();
  const stale = {
    ...ssnCompletedSnapshot,
    receipt: {
      ...required(ssnCompletedSnapshot.receipt),
      binding: { ...ssnBinding, phoneChallengeID: 'old-phone' },
    },
  };
  f.ssnSession.ssnEntry.mockImplementationOnce(async () => {
    f.setSSN(stale);
    return stale;
  });
  await f.tap('ssn-begin-entry');
  await f.tap('onboarding-ssn-continue');
  expect(f.shown('onboarding-environment')).toBe(false);
  expect(f.ssnSession.environmentCheck).not.toHaveBeenCalled();
  expect(f.ssnSession.release).not.toHaveBeenCalled();
});
test.each(['document', 'face', 'phone', 'ssn'] as const)(
  'final summary revalidates native %s custody and refuses changed evidence',
  async (source) => {
    const f = await fixture();
    await f.toEnvironment();
    await f.tap('onboarding-environment-run');
    if (source === 'document')
      f.setCheck({
        ...matched,
        result: { outcome: 'recordNotMatched', operationID: ssnBinding.documentOperationID, replayed: false },
      });
    if (source === 'face')
      f.setFace({
        ...facePass,
        state: 'completed',
        result: { outcome: 'manual_review', completedAt: '2026-10-11T12:01:00Z' },
      });
    if (source === 'phone') f.setPhone({ ...phoneComplete, failure: 'timedOut' });
    if (source === 'ssn') f.setSSN({ ...ssnCompletedSnapshot, recoveryNeeded: true });
    await f.tap('onboarding-environment-finish');
    expect(f.shown('onboarding-verification-result')).toBe(false);
    expect(f.shown('onboarding-environment')).toBe(true);
    expect(f.ssnSession.environmentCheck).toHaveBeenCalledTimes(1);
    expect(f.ssnSession.release).not.toHaveBeenCalled();
  },
);
test.each(['fail', 'manual_review'] as const)('native face %s cannot advance into SSN', async (outcome) => {
  const f = await fixture();
  await f.toFace();
  f.license.documentFaceCompare.mockImplementationOnce(async () => {
    const result: DocumentFaceSnapshot = {
      ...facePass,
      state: 'completed',
      result: { outcome, completedAt: '2026-10-11T12:01:00Z' },
    };
    f.setFace(result);
    return result;
  });
  await f.tap('onboarding-face-start');
  await act(async () => {
    f.license.subscribe.mock.calls.at(-1)?.[0]({
      type: 'selfieReadiness',
      permitsCapture: true,
      reason: null,
      blinkPhase: 'reopened',
    });
  });
  await f.tap('onboarding-face-capture');
  expect(f.shown('onboarding-face-continue')).toBe(false);
  expect(f.shown(`onboarding-face-${outcome}`)).toBe(true);
  expect(f.ssnSession.ssnEntry).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledTimes(3);
});
test('unmount after final check releases all three retained owners exactly once', async () => {
  const f = await fixture();
  await f.toEnvironment();
  await f.tap('onboarding-environment-run');
  await f.tap('onboarding-environment-finish');
  await act(async () => {
    required(view).unmount();
    view = undefined;
    await settle();
  });
  expect(f.license.release).toHaveBeenCalledTimes(1);
  expect(f.phoneSession.release).toHaveBeenCalledTimes(1);
  expect(f.ssnSession.release).toHaveBeenCalledTimes(1);
  expect(f.restored.release).toHaveBeenCalledTimes(1);
});

test('equivalent native face snapshot with reordered keys still completes final review', async () => {
  const f = await fixture();
  await f.toEnvironment();
  await f.tap('onboarding-environment-run');
  f.setFace({
    result: { completedAt: '2026-10-11T12:01:00Z', outcome: 'pass' },
    documentOperationID: faceInitial.documentOperationID,
    sourceSHA256: faceInitial.sourceSHA256,
    captureID: faceInitial.captureID,
    state: 'completed',
  });
  await f.tap('onboarding-environment-finish');
  expect(f.shown('onboarding-verification-result')).toBe(true);
  expect(f.license.documentFaceCompare).toHaveBeenCalledTimes(1);
});

test('early license review Back returns to preparation instead of discarding the guided route', async () => {
  const f = await fixture();
  await f.toReview();
  await act(async () => {
    const page = required(
      required(view)
        .root.findAllByType(Page)
        .find((node) => property(node, 'testID') === 'onboarding-license-review'),
    );
    await invoke(page, 'onClose');
    await settle();
  });
  expect(f.shown('onboarding-license-review')).toBe(false);
  expect(f.shown('identity-preparation')).toBe(true);
  expect(f.shown('identity-choose-id')).toBe(true);
});

test('combined review pushes all four read-only details and Back preserves summary until final close', async () => {
  const f = await fixture();
  await f.toEnvironment();
  await f.tap('onboarding-environment-run');
  await f.tap('onboarding-environment-finish');
  for (const section of ['license', 'phone', 'ssn', 'environment'] as const) {
    await f.tap(`onboarding-review-${section}`);
    expect(f.shown(`verification-detail-${section}`)).toBe(true);
    expect(f.shown('onboarding-verification-result')).toBe(true);
    const routeDescriptors = required(view)
      .root.findAll((node) => property(node, 'focused') === true)
      .map((node) => property(node, 'descriptor'));
    const descriptor = routeDescriptors.at(-1);
    if (!descriptor || typeof descriptor !== 'object' || !('route' in descriptor))
      throw new Error('Missing focused navigation descriptor');
    const route = descriptor.route;
    if (!route || typeof route !== 'object' || !('params' in route))
      throw new Error('Missing review detail route');
    expect(route).toMatchObject({ name: 'IdentityVerificationDetail' });
    expect(route.params).toEqual({ section });
    if (section === 'license') await f.tap('verification-license-native-details');
    if (section === 'phone') await f.tap('phone-native-details');
    if (section === 'ssn') await f.tap('ssn-native-details');
    await act(async () => {
      await nativeBack(required(view));
      await settle();
    });
    expect(f.shown(`verification-detail-${section}`)).toBe(false);
    expect(f.shown('onboarding-verification-result')).toBe(true);
  }
  expect(f.license.documentDetails).toHaveBeenCalledTimes(1);
  expect(f.phoneSession.phoneDetails).toHaveBeenCalledTimes(1);
  expect(f.ssnSession.ssnDetails).toHaveBeenCalledTimes(1);
  expect(f.license.documentCheck).toHaveBeenCalledTimes(1);
  expect(f.phoneSession.phoneSend).toHaveBeenCalledTimes(1);
  expect(f.license.documentFaceCompare).toHaveBeenCalledTimes(1);
  expect(f.ssnSession.ssnEntry).toHaveBeenCalledTimes(1);
  expect(f.ssnSession.environmentCheck).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledTimes(4);
  expect(f.license.release).not.toHaveBeenCalled();
  expect(f.phoneSession.release).not.toHaveBeenCalled();
  expect(f.ssnSession.release).not.toHaveBeenCalled();
  await f.tap('onboarding-verification-close');
  expect(f.shown('identity-hub')).toBe(true);
  expect(f.shown('identity-preparation')).toBe(false);
  expect(f.shown('identity-choose-id')).toBe(false);
  expect(f.shown('identity-welcome')).toBe(false);
});
