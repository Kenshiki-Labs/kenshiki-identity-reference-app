import type { CaptureEvent, PhoneCheckReceipt, PhoneCheckSnapshot } from '@kenshiki/identity-capture';
import { IdentityCaptureSession } from '@kenshiki/identity-capture';
import type { AppStateStatus } from 'react-native';
import { ActivityIndicator, AppState, Modal } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { documentConfiguration, documentSessionMethods } from '../testing/documentFixture';
import { phoneConfiguration } from '../testing/phoneFixture';
import {
  actionSheets,
  invoke,
  mockSession as makeSession,
  nativeBack,
  property,
  required,
  settle,
  without,
} from '../testing/support';
import App from '../app/App';
import { t } from '../locales/i18n';
import { PhoneFlow } from './PhoneFlow';
import { PhoneResultDetails } from './PhoneResultDetails';
import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';

const mockReady: PhoneCheckSnapshot = {
  stage: 'start',
  busy: false,
  failure: null,
  pending: false,
  sent: false,
  challengeReserved: false,
  receipt: null,
  recordedAt: null,
  sendAgainAt: null,
};
const mockReceipt: PhoneCheckReceipt = {
  challengeID: 'synthetic',

  receivedAt: '2026-10-08T12:00:00Z',
  completedAt: '2026-10-08T12:00:01Z',
  subjectComparison: {
    status: 'agreed',

    checkedAt: '2026-10-08T12:00:01Z',
  },
  subscriberFailure: null,
};
let mockSnapshot = mockReady;
let mockListener: ((event: CaptureEvent) => void) | undefined;
const mockSession = {
  subscribe: jest.fn((listener: (event: CaptureEvent) => void) => {
    mockListener = listener;
    return () => {
      mockListener = undefined;
    };
  }),
  phoneSnapshot: jest.fn(async () => mockSnapshot),
  phoneCancel: jest.fn(async () => mockSnapshot),
  phoneSend: jest.fn(async () => {
    mockSnapshot = { ...mockReady, stage: 'waiting', pending: true, sent: true, challengeReserved: true };
    return mockSnapshot;
  }),
  phoneResume: jest.fn(async () => mockSnapshot),
  phoneRetrySave: jest.fn(async () => mockSnapshot),
  phoneStartOver: jest.fn(async () => mockSnapshot),
  phoneErase: jest.fn(async () => {}),
  release: jest.fn(async () => {}),
};
const mockDocumentSession = {
  ...documentSessionMethods(),
  id: 'synthetic-document-session',
  subscribe: jest.fn(() => () => {}),
  cancel: jest.fn(async () => {}),
  release: jest.fn(async () => {}),
};
let mockDocumentSessionPending = true;
jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCaptureSession: {
    create: jest.fn(async () => {
      if (mockDocumentSessionPending) {
        mockDocumentSessionPending = false;
        return mockDocumentSession;
      }
      return mockSession;
    }),
  },
  IdentityCapturePreview: 'MockCapturePreview',
  IdentityCaptureImage: 'MockCaptureImage',
  IdentityDocumentInspection: 'MockDocumentInspection',
  IdentitySymbol: 'MockSymbol',
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockSnapshot = mockReady;
  mockDocumentSessionPending = true;
  mockListener = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(() => jest.restoreAllMocks());
async function renderPhone() {
  mockDocumentSessionPending = false;
  const complete = jest.fn();
  const exit = jest.fn();
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(
      <PhoneFlow configuration={{ phone: phoneConfiguration }} onComplete={complete} onExit={exit} />,
    );
  });
  const tap = async (id: string) => {
    await act(async () => {
      await invoke(view.root.findByProps({ testID: id }), 'onPress');
    });
  };
  return { view, tap, complete, exit };
}

test.each(['cancel', 'sheet back'])(
  'no-snapshot %s release failure blocks repeated navigation and replacement',
  async (entry) => {
    mockSession.phoneSnapshot.mockRejectedValueOnce({ code: 'contextChanged' });
    let reject!: (error: Error) => void;
    mockSession.release.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const { view, complete, exit } = await renderPhone();
    const close = () => Promise.resolve(invoke(view.root.findByType(Page), 'onClose'));
    let closing!: Promise<unknown>;
    await act(async () => {
      closing =
        entry === 'cancel'
          ? close()
          : Promise.resolve(invoke(view.root.findByProps({ testID: 'phone-sheet-back' }), 'onPress'));
      await close();
    });
    expect(mockSession.release).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    await act(async () => {
      reject(new Error('private release detail'));
      await closing;
    });
    expect(view.root.findAllByProps({ testID: 'phone-release-failure' }).length).toBeGreaterThan(0);
    expect(JSON.stringify(view.toJSON())).toContain(t('common.sessionRecovery'));
    expect(JSON.stringify(view.toJSON())).not.toContain('private release detail');
    expect(property(view.root.findByType(Page), 'covered')).toBe(true);
    expect(property(view.root.findByType(Modal), 'onRequestClose')).toBeUndefined();
    expect(view.root.findAllByProps({ testID: 'phone-sheet-back' })).toHaveLength(0);
    expect(view.root.findAllByProps({ testID: 'phone-sheet-dismiss' })).toHaveLength(0);
    await act(async () => {
      await close();
    });
    expect(exit).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(IdentityCaptureSession.create).toHaveBeenCalledTimes(1);
    expect(mockSession.phoneSend).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
    expect(mockSession.release).toHaveBeenCalledTimes(1);
  },
);

test('Send presents consent and duplicate taps cannot launch overlapping composition', async () => {
  let resolve!: (snapshot: PhoneCheckSnapshot) => void;
  mockSession.phoneSend.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { view } = await renderPhone();
  expect(JSON.stringify(view.toJSON())).toContain(t('phone.consent'));
  expect(mockSession.phoneSend).not.toHaveBeenCalled();
  let sending!: Promise<unknown>;
  await act(async () => {
    const button = view.root.findByProps({ testID: 'phone-send' });
    sending = Promise.resolve(invoke(button, 'onPress'));
    await invoke(button, 'onPress');
    await settle();
  });
  expect(mockSession.phoneSend).toHaveBeenCalledTimes(1);
  expect(mockSession.phoneSend).toHaveBeenCalledWith(true);
  expect(property(view.root.findByProps({ testID: 'phone-send' }), 'disabled')).toBe(true);
  await act(async () => {
    resolve({ ...mockReady, stage: 'waiting', pending: true, sent: true });
    await sending;
  });
  expect(view.root.findAllByProps({ testID: 'phone-result' })).toHaveLength(0);
  await act(async () => {
    view.unmount();
  });
});

test('resuming a saved challenge does not send; resend enables only when the reported time arrives', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-08T12:00:00Z'));
  mockSnapshot = {
    ...mockReady,
    stage: 'waiting',
    pending: true,
    sent: true,
    sendAgainAt: '2026-10-08T12:00:02Z',
  };
  const { view, tap } = await renderPhone();
  try {
    expect(mockSession.phoneResume).not.toHaveBeenCalled();
    await tap('phone-resume');
    expect(mockSession.phoneResume).toHaveBeenCalledTimes(1);
    expect(mockSession.phoneSend).not.toHaveBeenCalled();
    expect(mockSession.phoneStartOver).not.toHaveBeenCalled();
    expect(view.root.findAllByProps({ testID: 'phone-resume' })).toHaveLength(0);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(property(view.root.findByProps({ testID: 'phone-send-again' }), 'disabled')).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(property(view.root.findByProps({ testID: 'phone-send-again' }), 'disabled')).toBe(false);
    await tap('phone-send-again');
    expect(mockSession.phoneSend).toHaveBeenCalledTimes(1);
    expect(mockSession.phoneSend).toHaveBeenCalledWith(true);
  } finally {
    await act(async () => {
      view.unmount();
    });
    jest.useRealTimers();
  }
});

test('local save recovery retains previous receipt and never sends or replaces the check', async () => {
  mockSnapshot = {
    ...mockReady,
    stage: 'finishing',
    pending: true,
    receipt: mockReceipt,
    failure: 'storageUnavailable',
  };
  mockSession.phoneRetrySave.mockResolvedValueOnce({
    ...mockReady,
    stage: 'completed',
    receipt: mockReceipt,
  });
  const { view, tap } = await renderPhone();
  await tap('phone-sheet-dismiss');
  expect(JSON.stringify(view.toJSON())).toContain(t('common.previousCheck'));
  await tap('phone-save');
  expect(mockSession.phoneRetrySave).toHaveBeenCalledTimes(1);
  expect(mockSession.phoneSend).not.toHaveBeenCalled();
  expect(mockSession.phoneStartOver).not.toHaveBeenCalled();
  expect(view.root.findAllByProps({ testID: 'phone-save' })).toHaveLength(0);
  expect(view.root.findByProps({ testID: 'phone-result' })).toBeDefined();
  await act(async () => {
    view.unmount();
  });
});

test('erase requires confirmation, cancels first, and preserves receipt until erase succeeds', async () => {
  mockSnapshot = { ...mockReady, stage: 'completed', receipt: mockReceipt };
  const sheets = actionSheets();
  const { view, tap } = await renderPhone();
  await tap('phone-erase');
  expect(mockSession.phoneErase).not.toHaveBeenCalled();
  await act(async () => {
    sheets.last().choose(1);
    await settle();
  });
  expect(mockSession.phoneCancel).not.toHaveBeenCalled();
  await tap('phone-erase');
  mockSession.phoneErase.mockRejectedValueOnce({ code: 'storageUnavailable' });
  await act(async () => {
    sheets.last().choose(0);
    await settle();
  });
  expect(required(mockSession.phoneCancel.mock.invocationCallOrder[0])).toBeLessThan(
    required(mockSession.phoneErase.mock.invocationCallOrder[0]),
  );
  expect(view.root.findByProps({ testID: 'phone-result' })).toBeDefined();
  await tap('phone-sheet-dismiss');
  await tap('phone-erase');
  mockSession.phoneErase.mockImplementationOnce(async () => {
    mockSnapshot = mockReady;
  });
  await act(async () => {
    sheets.last().choose(0);
    await settle();
  });
  expect(view.root.findAllByProps({ testID: 'phone-result' })).toHaveLength(0);
  expect(view.root.findByProps({ testID: 'phone-send' })).toBeDefined();
  expect(mockSession.phoneSend).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});
async function renderApp() {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(
      <App configuration={{ phone: phoneConfiguration, document: documentConfiguration }} />,
    );
  });
  async function tap(id: string) {
    await act(async () => {
      if (id === 'native-back') {
        await nativeBack(view);
        return;
      }
      const button = required(
        view.root
          .findAllByProps({ testID: id })
          .filter((node) => typeof node.props.onPress === 'function')
          .at(-1),
      );
      await invoke(button, 'onPress');
    });
  }
  return { view, tap };
}
test('Phone opens from Identity, sending waits for receipt, native Back and reopen keep all findings', async () => {
  const { view, tap } = await renderApp();
  await tap('open-phone');
  expect(view.root.findByType(PhoneFlow).findAllByType(PageLead)).toHaveLength(1);
  expect(jest.mocked(IdentityCaptureSession.create).mock.calls.at(-1)?.[0]?.phone?.checkedDocumentID).toBe(
    'synthetic-front',
  );
  expect(mockDocumentSession.release).not.toHaveBeenCalled();
  expect(mockSession.phoneSend).not.toHaveBeenCalled();
  await tap('phone-send');
  expect(view.root.findByType(PhoneFlow).findAllByType(PageLead)).toHaveLength(1);
  expect(JSON.stringify(view.toJSON())).toContain('Waiting for your text');
  expect(view.root.findAllByProps({ testID: 'phone-result' })).toHaveLength(0);
  await act(async () => {
    mockSnapshot = { ...mockReady, stage: 'completed', receipt: mockReceipt };
    mockListener?.({ type: 'phoneSnapshot', snapshot: mockSnapshot });
  });
  let shown = JSON.stringify(view.toJSON());
  expect(shown).toContain('Subscriber details agree');
  for (const raw of ['12025550123', 'Synthetic carrier', 'synthetic-source', 'a'.repeat(64)])
    expect(shown).not.toContain(raw);
  expect(shown).not.toContain('Subscriber details differ');
  expect(shown).not.toContain('synthetic-source');
  expect(view.root.findAllByProps({ testID: 'phone-receipt-details' })).toHaveLength(0);
  expect(JSON.stringify(view.toJSON())).not.toContain('a'.repeat(64));
  await tap('native-back');
  await tap('open-phone');
  shown = JSON.stringify(view.toJSON());
  expect(view.root.findByType(PhoneFlow).findAllByType(PageLead)).toHaveLength(1);
  expect(shown).toContain('Subscriber details agree');
  expect(mockSession.phoneSend).toHaveBeenCalledTimes(1);
  expect(mockSession.release).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
  expect(mockSession.release).toHaveBeenCalledTimes(1);
});
test('a new check requires an action-sheet confirmation', async () => {
  mockSnapshot = { ...mockReady, stage: 'completed', receipt: mockReceipt };
  const sheets = actionSheets();
  const { view, tap } = await renderApp();
  await tap('open-phone');
  await tap('phone-new');
  expect(sheets.last().options).toEqual(['Start new check', 'Keep current check']);
  expect(mockSession.phoneStartOver).not.toHaveBeenCalled();
  await act(async () => {
    sheets.last().choose(0);
    await settle();
  });
  expect(mockSession.phoneStartOver).toHaveBeenCalledWith(true);
  await act(async () => {
    view.unmount();
  });
});
test('inactive message-composer transitions do not cancel; actual backgrounding pauses', async () => {
  let change: ((state: AppStateStatus) => void) | undefined;
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_kind, listener) => {
    change = listener;
    return { remove: jest.fn() };
  });
  const { view, tap } = await renderApp();
  await tap('open-phone');
  const cancelledBeforeInactive = mockSession.phoneCancel.mock.calls.length;
  await act(async () => {
    change?.('inactive');
  });
  expect(mockSession.phoneCancel).toHaveBeenCalledTimes(cancelledBeforeInactive);
  await act(async () => {
    change?.('background');
  });
  expect(mockSession.phoneCancel).toHaveBeenCalledTimes(cancelledBeforeInactive + 1);
  await act(async () => {
    view.unmount();
  });
  spy.mockRestore();
});
test('receipts without a comparison report its absence without triggering a new check', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<PhoneResultDetails receipt={without(mockReceipt, 'subjectComparison')} />);
  });
  expect(JSON.stringify(view.toJSON())).toContain('No comparison returned');
  expect(mockSession.phoneSend).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});

test('subscriber findings appear on the same result screen without another consent or send step', async () => {
  const subscriber: NonNullable<PhoneCheckReceipt['subscriberComparison']> = {
    evaluation: { status: 'incomplete' },
  };
  const { view, tap } = await renderApp();
  await tap('open-phone');
  await tap('phone-send');
  await act(async () => {
    mockSnapshot = {
      ...mockReady,
      stage: 'completed',
      receipt: { ...without(mockReceipt, 'subjectComparison'), subscriberComparison: subscriber },
    };
    mockListener?.({ type: 'phoneSnapshot', snapshot: mockSnapshot });
  });
  const shown = JSON.stringify(view.toJSON());
  expect(shown).toContain('Phone possession confirmed');
  expect(shown).toContain('Comparison incomplete');
  expect(shown).not.toContain('Required details agree');
  expect(shown).not.toContain('Synthetic provider');
  expect(view.root.findAllByProps({ testID: 'phone-bottom-sheet' })).toHaveLength(0);
  await tap('native-back');
  await tap('open-phone');
  expect(JSON.stringify(view.toJSON())).toContain('Comparison incomplete');
  expect(mockSession.phoneSend).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.unmount();
  });
});

test.each(['outcomeUnknown', 'capabilityUnavailable'] as const)(
  'subscriber %s preserves possession without automatic retry',
  async (failure) => {
    mockSnapshot = {
      ...mockReady,
      stage: 'completed',
      receipt: { ...without(mockReceipt, 'subjectComparison'), subscriberFailure: failure },
    };
    const { view, tap } = await renderApp();
    await tap('open-phone');
    const shown = JSON.stringify(view.toJSON());
    expect(shown).toContain('Phone possession confirmed');
    expect(shown).toContain(failure === 'outcomeUnknown' ? 'may have run' : 'was not run');
    expect(shown).not.toContain('Subscriber details agree');
    expect(mockSession.phoneSend).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
  },
);

test('an erased completed receipt offers explicit replacement instead of a resume loop', async () => {
  mockSnapshot = { ...mockReady, pending: true, failure: 'receiptUnavailable' };
  const sheets = actionSheets();
  const { view, tap } = await renderApp();
  await tap('open-phone');
  expect(JSON.stringify(view.toJSON())).toContain('can no longer be recovered');
  expect(mockSession.phoneResume).not.toHaveBeenCalled();
  expect(mockSession.phoneSend).not.toHaveBeenCalled();
  expect(view.root.findAllByProps({ testID: 'phone-resume' })).toHaveLength(0);
  expect(view.root.findAllByProps({ testID: 'phone-result' })).toHaveLength(0);
  await tap('phone-sheet-dismiss');
  await tap('phone-start-new');
  expect(mockSession.phoneStartOver).not.toHaveBeenCalled();
  await act(async () => {
    sheets.last().choose(0);
    await settle();
  });
  expect(mockSession.phoneStartOver).toHaveBeenCalledWith(true);
  expect(mockSession.phoneSend).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});

test.each([false, true])(
  'delayed restoration reveals one complete result without a Send-form flash (saved: %s)',
  async (saved) => {
    mockDocumentSessionPending = false;
    const completed: PhoneCheckSnapshot = { ...mockReady, stage: 'completed', receipt: mockReceipt };
    let resolve!: (snapshot: PhoneCheckSnapshot) => void;
    mockSession.phoneSnapshot.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let view!: renderer.ReactTestRenderer;
    await act(async () => {
      view = renderer.create(
        <PhoneFlow
          configuration={{ phone: phoneConfiguration }}
          saved={saved ? { session: makeSession(mockSession), snapshot: completed } : undefined}
          onComplete={jest.fn()}
          onExit={jest.fn()}
        />,
      );
    });
    for (const id of ['phone-result', 'phone-send', 'phone-erase'])
      expect(view.root.findAllByProps({ testID: id })).toHaveLength(0);
    expect(view.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    await act(async () => {
      mockListener?.({ type: 'phoneSnapshot', snapshot: completed });
    });
    expect(view.root.findAllByProps({ testID: 'phone-result' })).toHaveLength(0);
    // A late command reply cannot replace the newer event, nor reveal a transient start form.
    await act(async () => {
      resolve(mockReady);
    });
    expect(view.root.findAllByProps({ testID: 'phone-result' }).length).toBeGreaterThan(0);
    expect(view.root.findAllByProps({ testID: 'phone-send' })).toHaveLength(0);
    expect(view.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(JSON.stringify(view.toJSON())).not.toContain('a'.repeat(64));
    expect(mockSession.phoneSend).not.toHaveBeenCalled();
    expect(mockSession.phoneResume).not.toHaveBeenCalled();
    await act(async () => {
      view.unmount();
    });
  },
);

test('failed revalidation never flashes a handed-off receipt or offers Send', async () => {
  let reject!: (error: unknown) => void;
  mockSession.phoneSnapshot.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(
      <PhoneFlow
        configuration={{ phone: phoneConfiguration }}
        saved={{
          session: makeSession(mockSession),
          snapshot: { ...mockReady, stage: 'completed', receipt: mockReceipt },
        }}
        onComplete={jest.fn()}
        onExit={jest.fn()}
      />,
    );
  });
  expect(JSON.stringify(view.toJSON())).not.toContain('12025550123');
  await act(async () => {
    reject({ code: 'contextChanged' });
  });
  expect(JSON.stringify(view.toJSON())).not.toContain('12025550123');
  expect(view.root.findAllByProps({ testID: 'phone-send' })).toHaveLength(0);
  expect(view.root.findAllByProps({ testID: 'phone-bottom-sheet' }).length).toBeGreaterThan(0);
  expect(view.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  await act(async () => {
    view.unmount();
  });
});

test('handoff keeps the receipt mounted without inserting progress above it', async () => {
  mockSnapshot = { ...mockReady, stage: 'completed', receipt: mockReceipt };
  mockDocumentSessionPending = false;
  let resolve!: (snapshot: PhoneCheckSnapshot) => void;
  mockSession.phoneCancel.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const onComplete = jest.fn();
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(
      <PhoneFlow configuration={{ phone: phoneConfiguration }} onComplete={onComplete} onExit={jest.fn()} />,
    );
  });
  const result = view.root.findByProps({ testID: 'phone-result' });
  let closing: Promise<unknown> | undefined;
  await act(async () => {
    closing = Promise.resolve(invoke(view.root.findByProps({ testID: 'modal-cancel' }), 'onPress'));
    await settle();
  });
  expect(view.root.findByProps({ testID: 'phone-result' })).toBe(result);
  expect(JSON.stringify(view.toJSON())).not.toContain('Please wait');
  expect(view.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(onComplete).not.toHaveBeenCalled();
  await act(async () => {
    resolve(mockSnapshot);
    await closing;
  });
  expect(onComplete).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.unmount();
  });
});

test.each(['native-back', 'phone-sheet-back'])(
  'Phone recovery exit through %s retains failed handoffs and returns after success',
  async (exit) => {
    const { view, tap } = await renderApp();
    await tap('open-phone');
    mockSession.phoneCancel.mockRejectedValueOnce(new Error('settlement failed'));
    await tap('native-back');
    expect(view.root.findAllByType(PhoneFlow)).toHaveLength(1);
    const releases = mockSession.release.mock.calls.length;
    mockSession.phoneCancel.mockRejectedValueOnce(new Error('settlement still failed'));
    await tap(exit);
    expect(view.root.findAllByType(PhoneFlow)).toHaveLength(1);
    expect(mockSession.release).toHaveBeenCalledTimes(releases);
    const attempts = mockSession.phoneCancel.mock.calls.length;
    await tap(exit);
    expect(mockSession.phoneCancel).toHaveBeenCalledTimes(attempts + 1);
    expect(view.root.findAllByType(PhoneFlow)).toHaveLength(0);
    expect(mockSession.release).toHaveBeenCalledTimes(releases);
    await act(async () => view.unmount());
  },
);
