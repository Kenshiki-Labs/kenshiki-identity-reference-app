import type {
  CaptureEvent,
  Configuration,
  FaceComparison,
  PassportObservation,
} from '@kenshiki/identity-capture';
import { IdentityCaptureSession } from '@kenshiki/identity-capture';
import { Modal } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import {
  actionSheets,
  invoke,
  mockSession as makeSession,
  nativeBack,
  property,
  required,
  settle,
} from '../testing/support';
import App from '../app/App';
import { IdentityCaptureFlow } from './IdentityCaptureFlow';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { Page } from '../ui/Page';

let mockEvent: (event: CaptureEvent) => void;
const mockPassport: PassportObservation = {
  documentNumber: 'X1234567',
  birthDateYYMMDD: '850615',
  expiryDateYYMMDD: '320101',
  surname: 'SPECIMEN',
  givenNames: 'SYNTHETIC',
  nationality: 'UTO',
  issuingState: 'UTO',
  sex: 'F',
  portraitAvailable: true,
  portraitSHA256: 'reference',
  personalNumber: null,
  dateOfIssue: null,
  issuingAuthority: null,
  placeOfBirth: null,
  correspondence: { documentNumber: 'matches' },
  protocolVerdicts: { source: 'thisRead' },
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
const mockMRZ = {
  ...mockPassport,
  completeness: 'complete' as const,
  missingFields: [],
  normalizedLines: [],
};
const mockComparison: FaceComparison = {
  similarity: 0.55,
  outcome: 'pass',
  implementationVersion: 'test',
  referenceSHA256: 'reference',
  selfieSHA256: 'new-selfie',
  route: 'scrfd',
  modelLoadingSeconds: 0,
  comparisonSeconds: 1,
  admissionReceipt: {
    policyVersion: 'test',
    frameTimestamp: 1,
    anchorID: 'synthetic-anchor',
    blinkCompletedAt: 1,
    leftEyeClosed: 0,
    rightEyeClosed: 0,
    captureQualityEnforced: false,
    guideContainmentEnforced: false,
    trigger: 'automatic',
    eyesOpen: true,
    blinkAge: 0,
    consecutiveTrackedFrames: 10,
    steadyHoldDuration: 1,
  },
};
const mockSession = {
  id: 'test',
  subscribe: jest.fn((listener: (event: CaptureEvent) => void) => {
    mockEvent = listener;
    return jest.fn();
  }),
  startMRZ: jest.fn(async () => {}),
  captureMRZ: jest.fn(async () => mockMRZ),
  startSelfie: jest.fn(async () => {}),
  captureSelfie: jest.fn(async () => {}),
  compareFace: jest.fn(async () => mockComparison),
  listResults: jest.fn(
    async (): Promise<import('@kenshiki/identity-capture').CompletedResultDescriptor[]> => [
      {
        id: 'saved',
        revision: 1,
        recordedAt: '2026-10-08T12:00:00Z',
        kind: 'passport-read-v1',
        workflowID: 'saved-workflow',
        artifacts: [],
      },
    ],
  ),
  recoverPassport: jest.fn(async () => mockPassport),
  eraseResults: jest.fn(async () => {}),
  readPassport: jest.fn(async () => mockPassport),
  cancel: jest.fn(async () => {}),
  release: jest.fn(async () => {}),
};
jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCaptureSession: { create: jest.fn(async () => mockSession) },
  IdentityCapturePreview: 'MockCapturePreview',
  IdentityCaptureImage: 'MockCaptureImage',
  IdentityDocumentInspection: 'MockDocumentInspection',
  IdentitySymbol: 'MockSymbol',
}));

beforeEach(() => jest.clearAllMocks());

test.each([false, true])(
  'mounted selfie respects readiness and hands off once after cancellation settles (first cancel fails: %s)',
  async (cancelFails) => {
    if (cancelFails) mockSession.cancel.mockRejectedValueOnce({ code: 'operationFailed' });
    let captured!: () => void;
    mockSession.captureSelfie.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          captured = resolve;
        }),
    );
    const session = makeSession(mockSession);
    const completed = { session, passport: mockPassport, mrz: mockMRZ };
    const complete = jest.fn();
    const exit = jest.fn();
    let view!: renderer.ReactTestRenderer;
    await act(async () => {
      view = renderer.create(
        <IdentityCaptureFlow
          configuration={{}}
          completed={completed}
          resume="selfie"
          onComplete={complete}
          onExit={exit}
        />,
      );
    });
    const capture = () => view.root.findByProps({ label: t('passport.camera.captureSelfie') });
    expect(property(capture(), 'disabled')).toBe(true);
    expect(mockSession.startSelfie).toHaveBeenCalledWith(true);
    for (const ready of [true, false, true]) {
      await act(async () => {
        mockEvent({ type: 'selfieReadiness', permitsCapture: ready, reason: null, blinkPhase: 'reopened' });
      });
      expect(property(capture(), 'disabled')).toBe(!ready);
    }
    let capturePending!: Promise<unknown>;
    await act(async () => {
      capturePending = Promise.resolve(invoke(capture(), 'onPress'));
      await settle();
      mockEvent({ type: 'selfieCaptured', sha256: 'new-selfie', receipt: mockComparison.admissionReceipt });
    });
    expect(mockSession.captureSelfie).toHaveBeenCalledTimes(1);
    expect(mockSession.compareFace).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    await act(async () => {
      captured();
      await capturePending;
      await settle();
    });
    expect(mockSession.compareFace).toHaveBeenCalledTimes(1);
    expect(mockSession.cancel).toHaveBeenCalledTimes(1);
    if (cancelFails) {
      expect(complete).not.toHaveBeenCalled();
      expect(property(view.root.findByType(Page), 'covered')).toBe(true);
      expect(view.root.findAllByProps({ testID: 'capture-bottom-sheet' }).length).toBeGreaterThan(0);
      expect(mockSession.release).not.toHaveBeenCalled();
      await act(async () => {
        await settle();
      });
      expect(mockSession.cancel).toHaveBeenCalledTimes(1);
      await act(async () => {
        await invoke(view.root.findByProps({ testID: 'keep-passport' }), 'onPress');
      });
      expect(mockSession.cancel).toHaveBeenCalledTimes(2);
    }
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith({
      session,
      passport: mockPassport,
      mrz: mockMRZ,
      comparison: mockComparison,
    });
    await act(async () => {
      await invoke(view.root.findByType(Page), 'onClose');
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    expect(IdentityCaptureSession.create).not.toHaveBeenCalled();
    expect(mockSession.startSelfie).toHaveBeenCalledTimes(1);
    expect(mockSession.readPassport).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
    expect(mockSession.release).not.toHaveBeenCalled();
    await session.release();
    expect(mockSession.release).toHaveBeenCalledTimes(1);
  },
);

test.each(['cancel', 'recovery details'] as const)(
  '%s waits for release and keeps failed custody without navigation or a replacement session',
  async (entry) => {
    let rejectRelease!: (error: Error) => void;
    mockSession.release.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRelease = reject;
        }),
    );
    if (entry === 'recovery details')
      mockSession.startMRZ.mockRejectedValueOnce({ code: 'cameraUnavailable' });
    const exit = jest.fn();
    const complete = jest.fn();
    let view!: renderer.ReactTestRenderer;
    await act(async () => {
      view = renderer.create(<IdentityCaptureFlow configuration={{}} onComplete={complete} onExit={exit} />);
    });
    await act(async () => {
      await invoke(view.root.findByProps({ testID: 'start-passport-scan' }), 'onPress');
    });
    const close = () => Promise.resolve(invoke(view.root.findByType(Page), 'onClose'));
    let closing!: Promise<unknown>;
    await act(async () => {
      closing =
        entry === 'cancel'
          ? close()
          : Promise.resolve(invoke(view.root.findByProps({ testID: 'back-to-details' }), 'onPress'));
      await close();
    });
    expect(mockSession.release).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    await act(async () => {
      rejectRelease(new Error('private native release detail'));
      await closing;
    });
    expect(view.root.findAllByProps({ testID: 'passport-release-failure' }).length).toBeGreaterThan(0);
    expect(JSON.stringify(view.toJSON())).toContain(t('common.sessionRecovery'));
    expect(JSON.stringify(view.toJSON())).not.toContain('private native release detail');
    expect(property(view.root.findByType(Page), 'covered')).toBe(true);
    expect(property(view.root.findByType(Modal), 'onRequestClose')).toBeUndefined();
    expect(view.root.findAllByProps({ testID: 'back-to-details' })).toHaveLength(0);
    expect(view.root.findAllByProps({ testID: 'confirm-restart' })).toHaveLength(0);
    await act(async () => {
      await close();
    });
    expect(exit).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(IdentityCaptureSession.create).toHaveBeenCalledTimes(1);
    expect(mockSession.startMRZ).toHaveBeenCalledTimes(1);
    expect(mockSession.readPassport).not.toHaveBeenCalled();
    expect(mockSession.release).toHaveBeenCalledTimes(1);
    await act(async () => {
      view.unmount();
    });
    expect(mockSession.release).toHaveBeenCalledTimes(1);
  },
);

test('passport completion returns to its detail route and results reopen without repeating capture or deleting evidence', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<App configuration={{ trustAnchorsURL: 'file:///anchors.pem' }} />);
  });
  async function tap(id: string) {
    await act(async () => {
      if (id === 'native-back') {
        await nativeBack(view);
        return;
      }
      await invoke(view.root.findByProps({ testID: id }), 'onPress');
    });
  }
  await tap('open-capture-flow');
  await tap('start-passport-capture');
  await tap('start-passport-scan');
  await act(async () => {
    mockEvent({ type: 'mrzObservation', observation: mockMRZ });
  });
  expect(mockSession.captureMRZ).toHaveBeenCalledTimes(1);
  await tap('read-passport');
  expect(JSON.stringify(view.toJSON())).toContain('SYNTHETIC SPECIMEN');
  expect(JSON.stringify(view.toJSON())).toContain('PRINTED DETAILS AND CHIP');
  expect(view.root.findAllByProps({ testID: 'finish-capture' })).toHaveLength(0);
  await tap('native-back');
  expect(view.root.findByProps({ testID: 'face-match-card' })).toBeDefined();
  expect(mockSession.release).not.toHaveBeenCalled();
  await tap('open-capture-flow');
  expect(view.root.findByProps({ testID: 'passport-result' })).toBeDefined();
  expect(mockSession.startMRZ).toHaveBeenCalledTimes(1);
  expect(mockSession.readPassport).toHaveBeenCalledTimes(1);
  await act(async () => {
    const resultScreen = required(
      view.root
        .findAll(
          (node) =>
            typeof node.props.onHeaderBackButtonClicked === 'function' &&
            node.findAllByProps({ testID: 'passport-result' }).length > 0,
        )
        .at(-1),
    );
    invoke(resultScreen, 'onHeaderBackButtonClicked');
  });
  expect(view.root.findByProps({ testID: 'identity-hub' })).toBeDefined();
  expect(mockSession.release).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
  expect(mockSession.release).toHaveBeenCalledTimes(1);
});

test('shared Page Cancel releases an unfinished capture before returning to Identity', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<App configuration={{ trustAnchorsURL: 'file:///anchors.pem' }} />);
  });
  await act(async () => {
    await invoke(view.root.findByProps({ testID: 'open-capture-flow' }), 'onPress');
  });
  await act(async () => {
    await invoke(view.root.findByProps({ testID: 'start-passport-capture' }), 'onPress');
  });
  await act(async () => {
    await invoke(view.root.findByProps({ testID: 'start-passport-scan' }), 'onPress');
  });
  await act(async () => {
    await invoke(view.root.findByProps({ testID: 'modal-cancel' }), 'onPress');
  });
  expect(view.root.findAllByProps({ testID: 'modal-cancel' })).toHaveLength(0);
  expect(view.root.findByProps({ testID: 'identity-hub' })).toBeDefined();
  expect(mockSession.release).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
  expect(mockSession.release).toHaveBeenCalledTimes(1);
});

const durable: Configuration = {
  results: {
    directoryURL: 'file:///private/test-results',
    keychainService: 'synthetic-results',
    keychainAccount: 'evidence',
  },
};

test('app startup restores the saved passport and erasure removes custody before releasing review', async () => {
  const sheets = actionSheets();
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<App configuration={durable} />);
  });
  expect(JSON.stringify(view.toJSON())).toContain('SYNTHETIC SPECIMEN');
  expect(mockSession.recoverPassport).toHaveBeenCalledWith('saved-workflow');
  expect(mockSession.readPassport).not.toHaveBeenCalled();
  expect(mockSession.startMRZ).not.toHaveBeenCalled();
  expect(mockSession.release).not.toHaveBeenCalled();
  await act(async () => {
    invoke(view.root.findByProps({ testID: 'open-capture-flow' }), 'onPress');
  });
  expect(view.root.findByProps({ testID: 'passport-result' })).toBeDefined();
  await act(async () => {
    invoke(view.root.findByProps({ label: 'Clear results' }), 'onPress');
  });
  expect(sheets.last().options[0]).toBe('Clear results');
  expect(mockSession.eraseResults).not.toHaveBeenCalled();
  await act(async () => {
    sheets.last().choose(0);
    await settle();
  });
  expect(mockSession.eraseResults).toHaveBeenCalledTimes(1);
  expect(mockSession.release).toHaveBeenCalledTimes(1);
  expect(required(mockSession.eraseResults.mock.invocationCallOrder[0])).toBeLessThan(
    required(mockSession.release.mock.invocationCallOrder[0]),
  );
  expect(JSON.stringify(view.toJSON())).not.toContain('SYNTHETIC SPECIMEN');
  await act(async () => {
    view.unmount();
  });
});

test('a failed startup restore offers reopening and never silently starts a replacement', async () => {
  mockSession.listResults.mockRejectedValueOnce({ code: 'resultIntegrityFailure' });
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<App configuration={durable} />);
  });
  expect(JSON.stringify(view.toJSON())).toContain('Saved results could not be opened');
  expect(view.root.findByProps({ testID: 'open-capture-flow' }).props.disabled).toBe(true);
  expect(mockSession.readPassport).not.toHaveBeenCalled();
  expect(mockSession.eraseResults).not.toHaveBeenCalled();
  await act(async () => {
    invoke(view.root.findByProps({ label: 'Reopen saved results' }), 'onPress');
  });
  expect(JSON.stringify(view.toJSON())).toContain('SYNTHETIC SPECIMEN');
  await act(async () => {
    view.unmount();
  });
});

test('saved checks stay reachable after selecting one result', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<App configuration={durable} />);
  });
  try {
    mockSession.listResults.mockResolvedValue([
      {
        id: 'first',
        revision: 1,
        recordedAt: '2026-10-08T12:00:00Z',
        kind: 'passport-read-v1',
        workflowID: 'first',
        artifacts: [],
      },
      {
        id: 'second',
        revision: 1,
        recordedAt: '2026-10-08T12:00:00Z',
        kind: 'passport-read-v1',
        workflowID: 'second',
        artifacts: [],
      },
    ]);
    await act(async () => {
      await invoke(
        view.root
          .findByProps({ testID: 'identity-hub' })
          .findByProps({ label: 'Open saved passport checks' }),
        'onPress',
      );
    });
    expect(JSON.stringify(view.toJSON())).toContain('Saved passport checks');
    expect(view.root.findByProps({ testID: 'saved-passport-0' })).toBeDefined();
    expect(view.root.findByProps({ testID: 'saved-passport-1' })).toBeDefined();
    const choices = view.root.findByProps({ testID: 'saved-passports-list' }).findAllByType(Action);
    expect(choices).toHaveLength(3);
    for (const choice of choices) expect(property(choice, 'grouped')).toBe(true);
    expect(mockSession.eraseResults).not.toHaveBeenCalled();
    expect(mockSession.startMRZ).not.toHaveBeenCalled();
  } finally {
    await act(async () => view.unmount());
  }
});
