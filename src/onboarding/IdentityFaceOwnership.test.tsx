import type {
  CaptureSession,
  Configuration,
  DocumentCheckSnapshot,
  DocumentObservation,
} from '@kenshiki/identity-capture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { documentConfiguration, documentSessionMethods } from '../testing/documentFixture';
import { completedPhone, phoneConfiguration } from '../testing/phoneFixture';
import { mockSession, required, settle } from '../testing/support';
import type { IdentityCustody } from '../ui/ControllerCustody';
import { type IdentityWorkspace, useIdentityWorkspace } from '../app/useIdentityWorkspace';

const mockCreate = jest.fn<Promise<CaptureSession>, [Configuration]>();
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: { create: (configuration: Configuration) => mockCreate(configuration) },
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
}));
const configuration: Configuration = { document: documentConfiguration, phone: phoneConfiguration };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let workspace: IdentityWorkspace | undefined;
let view: ReactTestRenderer;
let owner: IdentityCustody;
const home = jest.fn();
const navigate = jest.fn();
function Harness() {
  workspace = useIdentityWorkspace(configuration, home, navigate, owner);
  return null;
}
function current() {
  return required(workspace);
}
async function setup() {
  const startup = mockSession({
    subscribe: jest.fn(() => jest.fn()),
    restoreDocumentSelection: jest.fn(async () => null),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
  mockCreate.mockResolvedValueOnce(startup);
  await act(async () => {
    view = create(<Harness />);
    await settle();
  });
  const document = mockSession({
    ...documentSessionMethods(),
    id: 'license-owner',
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
  const observation = await document.documentResult();
  const checked = await document.documentCheckRestore();
  const saved = { session: document, document: observation };
  await act(async () => {
    current().license.accept(saved);
    await settle();
  });
  const phone = mockSession({ id: 'phone-owner', release: jest.fn(async () => {}) });
  const result = { session: phone, snapshot: completedPhone };
  home.mockClear();
  navigate.mockClear();
  mockCreate.mockClear();
  const advance = async () => {
    let accepted = false;
    await act(async () => {
      accepted = current().phone.continueToFace(result);
      await settle();
    });
    return accepted;
  };
  return { document, observation, checked, saved, phone, result, advance };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
  mockCreate.mockRejectedValue(new Error('Unexpected acquisition'));
  owner = { releasing: Promise.resolve(), reportFailure: jest.fn() };
});
afterEach(async () => {
  await act(async () => view?.unmount());
  workspace = undefined;
});

test('face transfer uses the existing document owner, retains phone and rejects duplicate continuation', async () => {
  const f = await setup();
  expect(await f.advance()).toBe(true);
  expect(current().face.input).toEqual({
    saved: f.saved,
    documentOperationID: required(f.checked.result).operationID,
  });
  expect(current().license.result).toBeUndefined();
  expect(current().phone.result).toBe(f.result);
  expect(navigate.mock.calls).toEqual([['licenseFace', true]]);
  expect(await f.advance()).toBe(false);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(f.document.release).not.toHaveBeenCalled();
  expect(f.phone.release).not.toHaveBeenCalled();
});
test('exit before face claim restores the pending document owner and does not release it', async () => {
  const f = await setup();
  await f.advance();
  await act(async () => {
    current().face.exit();
    await settle();
  });
  expect(current().license.result).toBe(f.saved);
  expect(current().face.input).toBeUndefined();
  expect(f.document.release).not.toHaveBeenCalled();
  expect(home).toHaveBeenCalledTimes(1);
});
test('unclaimed face input and retained phone each release once on workspace unmount', async () => {
  const f = await setup();
  await f.advance();
  await act(async () => {
    view.unmount();
    await settle();
  });
  await owner.releasing;
  expect(f.document.release).toHaveBeenCalledTimes(1);
  expect(f.phone.release).toHaveBeenCalledTimes(1);
});
test('claimed face controller owns document release while workspace retains the phone', async () => {
  const f = await setup();
  await f.advance();
  await act(async () => current().face.claim());
  await act(async () => {
    view.unmount();
    await settle();
  });
  await owner.releasing;
  expect(f.document.release).not.toHaveBeenCalled();
  expect(f.phone.release).toHaveBeenCalledTimes(1);
});
test('late face handoff after workspace unmount releases instead of navigating', async () => {
  const f = await setup();
  await f.advance();
  await act(async () => current().face.claim());
  const accept = current().face.accept;
  home.mockClear();
  navigate.mockClear();
  await act(async () => {
    view.unmount();
    await settle();
  });
  await act(async () => {
    accept(f.saved);
    await settle();
  });
  await owner.releasing;
  expect(f.document.release).toHaveBeenCalledTimes(1);
  expect(home).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});
test.each(['pending', 'failed', 'contradicted', 'finishing'] as const)(
  '%s phone receipt cannot transfer document ownership',
  async (kind) => {
    const f = await setup();
    const snapshot = {
      ...completedPhone,
      ...(kind === 'pending'
        ? { pending: true }
        : kind === 'failed'
          ? { failure: 'timedOut' as const }
          : { stage: kind }),
    };
    let accepted = true;
    await act(async () => {
      accepted = current().phone.continueToFace({ session: f.phone, snapshot });
    });
    expect(accepted).toBe(false);
    expect(current().license.result).toBe(f.saved);
    expect(navigate).not.toHaveBeenCalled();
  },
);
test.each(['captureID', 'sourceSHA256'] as const)(
  'a restored check for another %s cannot transfer face ownership',
  async (key) => {
    const f = await setup();
    await act(async () =>
      current().license.checkChanged(f.document, {
        busy: false,
        loaded: true,
        failure: undefined,
        snapshot: { ...f.checked, [key]: 'wrong' },
      }),
    );
    expect(await f.advance()).toBe(false);
    expect(current().license.result).toBe(f.saved);
    expect(navigate).not.toHaveBeenCalled();
  },
);
test('active restoration blocks face transfer even if the prior status was accepted', async () => {
  const f = await setup();
  const restored = deferred<DocumentCheckSnapshot>();
  f.document.documentCheckRestore.mockReturnValueOnce(restored.promise);
  const saved = { ...f.saved };
  await act(async () => {
    current().license.accept(saved);
    await settle();
  });
  navigate.mockClear();
  expect(await f.advance()).toBe(false);
  expect(current().face.input).toBeUndefined();
  await act(async () => {
    restored.resolve(f.checked);
    await settle();
  });
  expect(await f.advance()).toBe(true);
  expect(current().face.input?.saved).toBe(saved);
});
test('rejected restoration cannot reuse the previous accepted check', async () => {
  const f = await setup();
  f.document.documentCheckRestore.mockRejectedValueOnce({ code: 'documentUnavailable' });
  await act(async () => {
    current().license.accept({ ...f.saved });
    await settle();
  });
  navigate.mockClear();
  expect(await f.advance()).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  expect(current().face.input).toBeUndefined();
});
test('an old continuation closure cannot use a check superseded by a rejected current status', async () => {
  const f = await setup();
  const stale = current().phone.continueToFace;
  await act(async () =>
    current().license.checkChanged(f.document, {
      busy: false,
      loaded: true,
      failure: undefined,
      snapshot: {
        ...f.checked,
        result: { ...required(f.checked.result), outcome: 'recordNotMatched' },
      },
    }),
  );
  let accepted = true;
  await act(async () => {
    accepted = stale(f.result);
  });
  expect(accepted).toBe(false);
  expect(current().license.result).toBe(f.saved);
  expect(navigate).not.toHaveBeenCalled();
});
test('replacing the document while continuation is pending cannot transfer the replacement via old callback', async () => {
  const f = await setup();
  const stale = current().phone.continueToFace;
  const replacement: DocumentObservation = {
    ...f.observation,
    front: { ...required(f.observation.front), captureID: 'replacement' },
  };
  const checked: DocumentCheckSnapshot = { ...f.checked, captureID: 'replacement' };
  f.document.documentCheckRestore.mockResolvedValueOnce(checked);
  await act(async () => {
    current().license.accept({ session: f.document, document: replacement });
    await settle();
  });
  navigate.mockClear();
  let accepted = true;
  await act(async () => {
    accepted = stale(f.result);
  });
  expect(accepted).toBe(false);
  expect(current().license.result?.document).toBe(replacement);
  expect(navigate).not.toHaveBeenCalled();
});

test('a superseded same-image accepted operation cannot advance through an old phone callback', async () => {
  const f = await setup();
  const stale = current().phone.continueToFace;
  const newer = { ...f.checked, result: { ...required(f.checked.result), operationID: 'new-operation' } };
  await act(async () =>
    current().license.checkChanged(f.document, {
      busy: false,
      loaded: true,
      failure: undefined,
      snapshot: newer,
    }),
  );
  let accepted = true;
  await act(async () => {
    accepted = stale(f.result);
  });
  expect(accepted).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  expect(await f.advance()).toBe(true);
  expect(current().face.input?.documentOperationID).toBe('new-operation');
});

test('face return restores the document owner before workspace cleanup', async () => {
  const f = await setup();
  await f.advance();
  await act(async () => current().face.claim());
  const returned = {
    ...f.saved,
    snapshot: {
      state: 'completed' as const,
      captureID: required(f.observation.front).captureID,
      sourceSHA256: required(f.observation.front).sha256,
      documentOperationID: required(f.checked.result).operationID,
      result: { outcome: 'pass' as const, completedAt: '2026-10-11T12:00:00Z' },
    },
  };
  await act(async () => {
    current().face.accept(returned);
    await settle();
  });
  expect(current().license.result).toBe(returned);
  expect(current().face.input).toBeUndefined();
  expect(f.document.release).not.toHaveBeenCalled();
  expect(home).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.unmount();
    await settle();
  });
  await owner.releasing;
  expect(f.document.release).toHaveBeenCalledTimes(1);
  expect(f.phone.release).toHaveBeenCalledTimes(1);
});
