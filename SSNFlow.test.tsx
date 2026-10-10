import type { Configuration, SSNSessionSnapshot, SSNVerificationReceipt } from '@kenshiki/identity-capture';
import renderer, { act } from 'react-test-renderer';
import { ssnBinding, ssnOperationID, ssnReceipt } from './__tests__/ssnFixture';
import { invoke, required } from './__tests__/support';
import App from './App';
import { SSNResultDetails } from './SSNFlow';

const mockReceipt: SSNVerificationReceipt = ssnReceipt;
const mockReady: SSNSessionSnapshot = {
  state: 'ready',
  entryDigits: '',
  confirmation: null,
  attempt: null,
  receipt: null,
  failure: null,
  recoveryNeeded: false,
  busy: false,
};
let mockSnapshot = mockReady;
const mockSession = {
  id: 'ssn',
  ssnSnapshot: jest.fn(async () => mockSnapshot),
  ssnRequestConfirmation: jest.fn(async (digits: string) => {
    mockSnapshot = {
      ...mockSnapshot,
      state: 'confirming',
      entryDigits: digits,
      confirmation: { id: 'token', digits },
    };
    return mockSnapshot;
  }),
  ssnRequestFreshConfirmation: jest.fn(async (digits: string) => {
    mockSnapshot = {
      ...mockSnapshot,
      state: 'confirming',
      entryDigits: digits,
      confirmation: { id: 'fresh-token', digits },
    };
    return mockSnapshot;
  }),
  ssnConfirm: jest.fn(async (_id: string) => {
    mockSnapshot = {
      ...mockReady,
      state: 'completed',
      attempt: { operationID: ssnOperationID, binding: ssnBinding },
      receipt: mockReceipt,
    };
    return mockSnapshot;
  }),
  ssnResendUnresolved: jest.fn(async () => mockSnapshot),
  ssnRecover: jest.fn(async () => mockSnapshot),
  ssnCancel: jest.fn(async () => {
    mockSnapshot = { ...mockSnapshot, state: 'ready', entryDigits: '', confirmation: null };
    return mockSnapshot;
  }),
  release: jest.fn(async () => {}),
};
jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('../../ReactNative/identity-capture/src/codes')>(
    '../../ReactNative/identity-capture/src/codes',
  ).isCaptureErrorCode,
  IdentityCaptureSession: { create: jest.fn(async () => mockSession) },
  IdentityCapturePreview: 'MockCapturePreview',
  IdentityCaptureImage: 'MockCaptureImage',
  IdentitySymbol: 'MockSymbol',
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockSnapshot = mockReady;
});
const configuration: Configuration = {
  ssn: {
    contextID: 'test-holder',
    providerID: 'test-provider',
    directoryURL: 'file:///test',
    keychainService: 'test',
    keychainAccount: 'test',
  },
};
async function renderApp(config = configuration) {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<App configuration={config} />);
  });
  async function tap(id: string) {
    await act(async () => {
      const button = required(
        view.root
          .findAllByProps({ testID: id })
          .filter((node) => typeof node.props.onPress === 'function')
          .at(-1),
      );
      await invoke(button, 'onPress');
    });
  }
  async function enter() {
    await act(async () => {
      invoke(view.root.findByProps({ testID: 'ssn-entry' }), 'onChangeText', '000001234');
    });
  }
  return { view, tap, enter };
}
test('SSN review displays exact digits in a bottom sheet and a completed result reopens from Identity', async () => {
  const { view, tap, enter } = await renderApp();
  await tap('open-ssn');
  expect(view.root.findAllByProps({ testID: 'ssn-entry' })).toHaveLength(0);
  await tap('ssn-begin-entry');
  await enter();
  // The field owns what is typed (S-12): JavaScript never writes a value back into it.
  expect(view.root.findByProps({ testID: 'ssn-entry' }).props.value).toBeUndefined();
  await tap('ssn-review-number');
  expect(view.root.findByProps({ testID: 'ssn-bottom-sheet' })).toBeDefined();
  expect(view.root.findByProps({ testID: 'ssn-confirmation-number' }).props.children).toBe('000-00-1234');
  expect(mockSession.ssnConfirm).not.toHaveBeenCalled();
  await tap('ssn-confirm');
  expect(mockSession.ssnConfirm).toHaveBeenCalledWith('token');
  expect(JSON.stringify(view.toJSON())).toContain('The number was issued');
  expect(JSON.stringify(view.toJSON())).not.toContain('000-00-1234');
  await tap('finish-ssn');
  await tap('open-ssn');
  expect(view.root.findByProps({ testID: 'ssn-result' })).toBeDefined();
  expect(mockSession.ssnConfirm).toHaveBeenCalledTimes(1);
  expect(mockSession.release).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
  expect(mockSession.release).toHaveBeenCalledTimes(1);
});
test('leaving the exact-number sheet clears the input before the Identity card can reopen it', async () => {
  const { view, tap, enter } = await renderApp();
  await tap('open-ssn');
  await tap('ssn-begin-entry');
  await enter();
  await tap('ssn-review-number');
  await tap('ssn-back-to-identity');
  expect(JSON.stringify(view.toJSON())).not.toContain('000-00-1234');
  await tap('open-ssn');
  await tap('ssn-begin-entry');
  expect(view.root.findByProps({ testID: 'ssn-entry' }).props.defaultValue).toBe('');
  expect(mockSession.ssnConfirm).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});
test('missing provider presents a bottom sheet without an ID or phone CTA', async () => {
  const { view, tap } = await renderApp({});
  await tap('open-ssn');
  expect(view.root.findByProps({ testID: 'ssn-bottom-sheet' })).toBeDefined();
  expect(JSON.stringify(view.toJSON())).toContain('This check is not ready');
  expect(JSON.stringify(view.toJSON())).not.toMatch(/capture or choose ID|connected document|phone check/i);
  expect(view.root.findAllByProps({ testID: 'ssn-retry' })).toHaveLength(0);
  await tap('ssn-back-to-identity');
  expect(view.root.findByProps({ testID: 'open-ssn' })).toBeDefined();
  expect(mockSession.ssnConfirm).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});
test('issuance unavailable is not promoted to identity verification', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(<SSNResultDetails receipt={{ ...mockReceipt, issuance: 'unavailable' }} />);
  });
  const shown = JSON.stringify(view.toJSON());
  expect(shown).toContain('No issuance answer was available');
  expect(shown).not.toContain('The number was issued');
  expect(shown).not.toContain('Verified');
  expect(shown).toContain('An unanswered check cannot establish agreement');
  await act(async () => {
    view.unmount();
  });
});
test('an unresolved attempt offers status and no replacement purchase', async () => {
  mockSnapshot = {
    ...mockReady,
    state: 'failed',
    recoveryNeeded: true,
    attempt: { operationID: ssnOperationID, binding: ssnBinding },
  };
  const { view, tap } = await renderApp();
  await tap('open-ssn');
  await tap('ssn-resend-unresolved');
  expect(mockSession.ssnRecover).toHaveBeenCalledTimes(1);
  expect(mockSession.ssnResendUnresolved).not.toHaveBeenCalled();
  expect(view.root.findAllByProps({ testID: 'ssn-new-attempt' })).toHaveLength(0);
  expect(mockSession.ssnRequestFreshConfirmation).not.toHaveBeenCalled();
  expect(mockSession.ssnConfirm).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});

test('returned findings show source values, while older receipts explain why details are absent', async () => {
  let view!: renderer.ReactTestRenderer;
  await act(async () => {
    view = renderer.create(
      <SSNResultDetails
        receipt={{
          ...mockReceipt,
          details: {
            source: 'Synthetic provider',
            responseCode: 0,
            reportedStatus: 'Item1',
            region: 'CA',
            issueStart: '1978-01-01',
            issueEnd: '1979-12-31',
            code: '2',
            codeDescription: 'Issued in the reported period',
          },
        }}
      />,
    );
  });
  let shown = JSON.stringify(view.toJSON());
  for (const value of ['CA', 'Jan 1, 1978', 'Dec 31, 1979', 'Issued in the reported period', 'Item1']) {
    expect(shown).toContain(value);
  }
  expect(shown).not.toContain('Synthetic provider');
  await act(async () => {
    view.update(
      <SSNResultDetails
        receipt={{
          ...mockReceipt,
          details: {
            source: 'Synthetic provider',
            responseCode: 0,
            reportedStatus: 'Item1',
          },
        }}
      />,
    );
  });
  shown = JSON.stringify(view.toJSON());
  expect(shown).toContain('Not returned');
  expect(shown).not.toContain('Jan 1, 1978');
  await act(async () => {
    view.update(
      <SSNResultDetails receipt={{ ...mockReceipt, reportKind: 'issuanceOnly', fiveChecks: null }} />,
    );
  });
  shown = JSON.stringify(view.toJSON());
  expect(shown).toContain('Its details were not retained');
  expect(mockSession.ssnConfirm).not.toHaveBeenCalled();
  await act(async () => {
    view.unmount();
  });
});

/** S-12. Keystrokes arrive faster than React renders: each change event below is delivered with no
 * render between it and the next, as on a phone when typing outruns the JavaScript thread. Every
 * digit must survive in order, and no render may write older text back into the field. */
test('fast SSN entry keeps every digit in order and never writes stale text back', async () => {
  const { view, tap } = await renderApp();
  await tap('open-ssn');
  await tap('ssn-begin-entry');
  const field = view.root.findByProps({ testID: 'ssn-entry' });
  const typed = '000001234';
  const pushedBack: unknown[] = [];
  await act(async () => {
    for (let length = 1; length <= typed.length; length += 1) {
      invoke(field, 'onChangeText', typed.slice(0, length));
      pushedBack.push(view.root.findByProps({ testID: 'ssn-entry' }).props.value);
    }
  });
  expect(pushedBack.every((value) => value === undefined)).toBe(true);
  const entry = view.root.findByProps({ testID: 'ssn-entry' });
  expect(entry.props.value).toBeUndefined();
  expect(entry.props.maxLength).toBe(9);
  await tap('ssn-review-number');
  expect(mockSession.ssnRequestConfirmation).toHaveBeenCalledWith(typed);
  expect(view.root.findByProps({ testID: 'ssn-confirmation-number' }).props.children).toBe('000-00-1234');
  await act(async () => view.unmount());
});

test('renders between keystrokes never update the native default text seed', async () => {
  const { view, tap } = await renderApp();
  await tap('open-ssn');
  await tap('ssn-begin-entry');
  const typed = '000001234';
  for (let length = 1; length <= typed.length; length += 1) {
    await act(async () => {
      invoke(view.root.findByProps({ testID: 'ssn-entry' }), 'onChangeText', typed.slice(0, length));
    });
    const entry = view.root.findByProps({ testID: 'ssn-entry' });
    expect(entry.props.value).toBeUndefined();
    expect(entry.props.defaultValue).toBe('');
  }
  await tap('ssn-review-number');
  expect(mockSession.ssnRequestConfirmation).toHaveBeenCalledWith(typed);
  await act(async () => view.unmount());
});

test('pasted text that is not only digits restarts the field from the digits kept', async () => {
  const { view, tap } = await renderApp();
  await tap('open-ssn');
  await tap('ssn-begin-entry');
  await act(async () => {
    invoke(view.root.findByProps({ testID: 'ssn-entry' }), 'onChangeText', '000-00-1234');
  });
  const restarted = view.root.findByProps({ testID: 'ssn-entry' });
  expect(restarted.props.defaultValue).toBe('000001234');
  expect(restarted.props.autoFocus).toBe(true);
  await act(async () => view.unmount());
});
