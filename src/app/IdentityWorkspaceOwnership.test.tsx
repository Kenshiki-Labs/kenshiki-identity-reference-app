import type { CaptureSession, Configuration, PassportObservation } from '@kenshiki/identity-capture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { documentConfiguration, documentSessionMethods } from '../testing/documentFixture';
import { mockSession, required, settle } from '../testing/support';
import type { IdentityCustody } from '../ui/ControllerCustody';
import { type IdentityWorkspace, useIdentityWorkspace } from './useIdentityWorkspace';

const mockCreate = jest.fn<Promise<CaptureSession>, [Configuration]>();
jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureSession: { create: (configuration: Configuration) => mockCreate(configuration) },
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function nativeSession(id: string) {
  return mockSession({
    ...documentSessionMethods(),
    id,
    subscribe: jest.fn(() => () => {}),
    listResults: jest.fn(async () => []),
    eraseDocuments: jest.fn(async () => {}),
    eraseResults: jest.fn(async () => {}),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  });
}
const empty: Configuration = {};
const durable: Configuration = {
  results: { directoryURL: 'file:///ownership', keychainService: 'ownership', keychainAccount: 'results' },
};
const passport: PassportObservation = {
  documentNumber: 'SYNTHETIC',
  birthDateYYMMDD: '850615',
  expiryDateYYMMDD: '320101',
  surname: 'SPECIMEN',
  givenNames: 'SYNTHETIC',
  nationality: 'UTO',
  issuingState: 'UTO',
  sex: 'F',
  portraitAvailable: true,
  portraitSHA256: 'synthetic-portrait',
  personalNumber: null,
  dateOfIssue: null,
  issuingAuthority: null,
  placeOfBirth: null,
  correspondence: { documentNumber: 'matches' },
  protocolVerdicts: { source: 'thisRead' },
  protocols: {
    countrySigningChain: 'succeeded',
    documentSignature: 'succeeded',
    dataGroupHashes: 'succeeded',
    activeAuthentication: 'notPerformed',
    chipAuthentication: 'notPerformed',
    basicAccessControl: 'succeeded',
    pace: 'notPerformed',
  },
};
async function adoptPassport(session: ReturnType<typeof nativeSession>) {
  await act(async () => required(workspace).passport.accept({ session, passport }));
  home.mockClear();
}
let view: ReactTestRenderer | undefined;
let workspace: IdentityWorkspace | undefined;
let owner: IdentityCustody;
const home = jest.fn();
const navigate = jest.fn();
function Harness({ configuration = empty }: { configuration?: Configuration }) {
  workspace = useIdentityWorkspace(configuration, home, navigate, owner);
  return null;
}
async function mount(configuration = empty) {
  await act(async () => {
    view = create(<Harness configuration={configuration} />);
  });
}
async function adopt(session: ReturnType<typeof nativeSession>) {
  const document = await session.documentResult();
  await act(async () => required(workspace).license.accept({ session, document }));
  home.mockClear();
}
beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
  mockCreate.mockRejectedValue(new Error('Unexpected acquisition'));
  owner = { releasing: Promise.resolve(), reportFailure: jest.fn() };
});
afterEach(async () => {
  await act(async () => view?.unmount());
  view = undefined;
  workspace = undefined;
});

test('opening saved passports waits for retained release and blocks duplicate open and all starts', async () => {
  await mount();
  const session = nativeSession('passport');
  await adoptPassport(session);
  const released = deferred<void>();
  session.release.mockImplementationOnce(() => released.promise);
  await act(async () => {
    required(workspace).passport.openSaved();
  });
  expect(required(workspace).passport.openingResults).toBe(true);
  expect(required(workspace).passport.result?.session).toBe(session);
  await act(async () => {
    const current = required(workspace);
    current.passport.openSaved();
    current.passport.start();
    current.passport.start('selfie');
    current.license.start();
    current.phone.start();
    current.ssn.start();
    current.recovery.retryRestore();
  });
  expect(session.release).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
  await act(async () => {
    released.resolve();
    await settle();
  });
  expect(navigate.mock.calls).toEqual([['passport']]);
  expect(required(workspace).passport.result).toBeUndefined();
  expect(required(workspace).passport.input).toEqual({});
  expect(required(workspace).passport.openingResults).toBe(false);
  expect(session.eraseResults).not.toHaveBeenCalled();
  expect(home).not.toHaveBeenCalled();
});

test('saved-passport release excludes destructive clear commands until opening has settled', async () => {
  const startup = nativeSession('startup');
  mockCreate.mockResolvedValueOnce(startup);
  await mount(durable);
  const session = nativeSession('passport');
  await adoptPassport(session);
  const released = deferred<void>();
  session.release.mockImplementationOnce(() => released.promise);
  await act(async () => {
    required(workspace).passport.openSaved();
  });
  let clearing: Promise<void> | undefined;
  await act(async () => {
    required(workspace).recovery.requestClear('passport');
    clearing = required(workspace).recovery.clear('passport');
    await settle();
  });
  const erasesWhileOpening = session.eraseResults.mock.calls.length;
  const confirmationWhileOpening = required(workspace).recovery.confirmingClear;
  await act(async () => {
    released.resolve();
    await clearing;
    await settle();
  });
  expect(erasesWhileOpening).toBe(0);
  expect(confirmationWhileOpening).toBeUndefined();
  expect(home).not.toHaveBeenCalled();
  expect(navigate.mock.calls).toEqual([['passport']]);
});

test('failed saved-passport release retains evidence and repeated open cannot erase the failed custody', async () => {
  await mount();
  const session = nativeSession('passport');
  await adoptPassport(session);
  const failure = new Error('release failed');
  session.release.mockRejectedValueOnce(failure);
  await act(async () => {
    required(workspace).passport.openSaved();
    await settle();
  });
  expect(required(workspace).passport.result?.session).toBe(session);
  expect(required(workspace).recovery.restoreFailure).toBeDefined();
  expect(navigate).not.toHaveBeenCalled();
  expect(home).not.toHaveBeenCalled();
  await expect(owner.releasing).rejects.toBe(failure);
  await act(async () => {
    required(workspace).passport.openSaved();
    await settle();
  });
  await expect(owner.releasing).rejects.toBe(failure);
  expect(required(workspace).passport.result?.session).toBe(session);
  expect(required(workspace).recovery.restoreFailure).toBeDefined();
  expect(navigate).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
  expect(session.eraseResults).not.toHaveBeenCalled();
});

test('failed retained release prevents handing the invalid owner to a new flow', async () => {
  await mount();
  const session = nativeSession('passport');
  await adoptPassport(session);
  session.release.mockRejectedValueOnce(new Error('release failed'));
  await act(async () => {
    required(workspace).passport.openSaved();
    await settle();
  });
  await act(async () => {
    const current = required(workspace);
    current.passport.start('selfie');
    current.license.start();
    current.phone.start();
    current.ssn.start();
  });
  expect(navigate).not.toHaveBeenCalled();
  expect(required(workspace).passport.result?.session).toBe(session);
  expect(required(workspace).passport.input).toEqual({});
  expect(mockCreate).not.toHaveBeenCalled();
});

test.each([false, true])(
  'late handoff releases its session through custody after unmount (failure: %s)',
  async (fails) => {
    await mount();
    const accept = required(workspace).license.accept;
    await act(async () => required(view).unmount());
    view = undefined;
    const late = nativeSession('late');
    const released = deferred<void>();
    late.release.mockImplementation(() => released.promise);
    const document = await late.documentResult();
    await act(async () => accept({ session: late, document }));
    expect(late.release).toHaveBeenCalledTimes(1);
    expect(home).not.toHaveBeenCalled();
    const next = nativeSession('next');
    mockCreate.mockResolvedValue(next);
    await mount(durable);
    expect(mockCreate).not.toHaveBeenCalled();
    const failure = new Error('release refused');
    await act(async () => {
      if (fails) released.reject(failure);
      else released.resolve();
    });
    if (fails) {
      await expect(owner.releasing).rejects.toBe(failure);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(owner.reportFailure).toHaveBeenCalledWith(failure);
      expect(required(workspace).recovery.restoreFailure).toBeDefined();
    } else {
      await expect(owner.releasing).resolves.toBeDefined();
      expect(mockCreate).toHaveBeenCalledTimes(1);
    }
    expect(late.release).toHaveBeenCalledTimes(1);
  },
);

test('a stale document-clear confirmation cannot erase its replaced owner', async () => {
  await mount();
  const previous = nativeSession('previous');
  const replacement = nativeSession('replacement');
  await adopt(previous);
  await act(async () => required(workspace).recovery.requestClear('document'));
  await adopt(replacement);
  await act(async () => required(workspace).recovery.confirmClear());
  expect(previous.eraseDocuments).not.toHaveBeenCalled();
  expect(replacement.eraseDocuments).not.toHaveBeenCalled();
  expect(previous.release).not.toHaveBeenCalled();
  expect(required(workspace).license.result?.session).toBe(replacement);
  expect(home).not.toHaveBeenCalled();
});

test('document erase waits for erasure then release, blocks duplicate work, and clears only after both', async () => {
  await mount();
  const session = nativeSession('document');
  await adopt(session);
  const erased = deferred<void>();
  const released = deferred<void>();
  session.eraseDocuments.mockImplementation(() => erased.promise);
  session.release.mockImplementation(() => released.promise);
  let clearing: Promise<void> | undefined;
  await act(async () => {
    clearing = required(workspace).recovery.clear('document');
  });
  expect(required(workspace).recovery.clearing).toBe(true);
  expect(session.release).not.toHaveBeenCalled();
  await act(async () => {
    await required(workspace).recovery.clear('document');
    required(workspace).license.start();
    required(workspace).passport.start();
    required(workspace).passport.openSaved();
  });
  expect(session.eraseDocuments).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => erased.resolve());
  expect(session.release).toHaveBeenCalledTimes(1);
  expect(required(workspace).license.result?.session).toBe(session);
  expect(home).not.toHaveBeenCalled();
  await act(async () => {
    released.resolve();
    await clearing;
  });
  expect(required(workspace).license.result).toBeUndefined();
  expect(required(workspace).recovery.clearing).toBe(false);
  expect(home).toHaveBeenCalledTimes(1);
  await act(async () => required(view).unmount());
  view = undefined;
  expect(session.release).toHaveBeenCalledTimes(1);
});

test.each(['erase', 'release'] as const)(
  'document %s failure retains evidence and exposes recovery',
  async (stage) => {
    await mount();
    const session = nativeSession('document');
    await adopt(session);
    const failure = { code: 'storageUnavailable' };
    if (stage === 'erase') session.eraseDocuments.mockRejectedValueOnce(failure);
    else session.release.mockRejectedValueOnce(failure);
    await act(async () => required(workspace).recovery.clear('document'));
    expect(required(workspace).license.result?.session).toBe(session);
    expect(required(workspace).recovery.clearFailure?.target).toBe('document');
    expect(required(workspace).recovery.clearing).toBe(false);
    expect(home).not.toHaveBeenCalled();
    if (stage === 'erase') expect(session.release).not.toHaveBeenCalled();
    else {
      await expect(owner.releasing).rejects.toBe(failure);
      // An idempotent second release cannot turn a failed custody lifetime into success.
      await act(async () => required(workspace).recovery.clear('document'));
      await expect(owner.releasing).rejects.toBe(failure);
      expect(required(workspace).license.result?.session).toBe(session);
      expect(home).not.toHaveBeenCalled();
    }
  },
);

test('replacing a document during release cannot clear or navigate away from the replacement', async () => {
  await mount();
  const previous = nativeSession('previous');
  const replacement = nativeSession('replacement');
  await adopt(previous);
  const released = deferred<void>();
  previous.release.mockImplementation(() => released.promise);
  let clearing: Promise<void> | undefined;
  await act(async () => {
    clearing = required(workspace).recovery.clear('document');
  });
  expect(previous.release).toHaveBeenCalledTimes(1);
  await adopt(replacement);
  await act(async () => {
    released.resolve();
    await clearing;
  });
  expect(required(workspace).license.result?.session).toBe(replacement);
  expect(replacement.eraseDocuments).not.toHaveBeenCalled();
  expect(replacement.release).not.toHaveBeenCalled();
  expect(home).not.toHaveBeenCalled();
});

test.each([false, true])(
  'temporary unreadable-store acquisition reserves custody before holder replacement (release failure: %s)',
  async (fails) => {
    const initial = nativeSession('initial');
    const temporary = nativeSession('temporary');
    const replacement = nativeSession('replacement');
    const acquired = deferred<CaptureSession>();
    const released = deferred<void>();
    temporary.release.mockImplementation(() => released.promise);
    mockCreate
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => acquired.promise)
      .mockResolvedValueOnce(replacement);
    await mount(durable);
    let clearing: Promise<void> | undefined;
    await act(async () => {
      clearing = required(workspace).recovery.clear('passport');
    });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    await act(async () =>
      required(view).update(<Harness key="replacement" configuration={{ ...durable }} />),
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
    await act(async () => acquired.resolve(temporary));
    expect(temporary.eraseResults).not.toHaveBeenCalled();
    expect(temporary.release).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const failure = new Error('temporary release failed');
    await act(async () => {
      if (fails) released.reject(failure);
      else released.resolve();
      await clearing;
      await settle();
    });
    if (fails) {
      await expect(owner.releasing).rejects.toBe(failure);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(required(workspace).recovery.restoreFailure).toBeDefined();
    } else {
      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(replacement.listResults).toHaveBeenCalledTimes(1);
    }
    expect(temporary.release).toHaveBeenCalledTimes(1);
    expect(home).not.toHaveBeenCalled();
  },
);

test('leaving during document erase releases ownership once and suppresses its late navigation', async () => {
  await mount();
  const session = nativeSession('document');
  await adopt(session);
  const erased = deferred<void>();
  session.eraseDocuments.mockImplementation(() => erased.promise);
  let clearing: Promise<void> | undefined;
  await act(async () => {
    clearing = required(workspace).recovery.clear('document');
  });
  await act(async () => required(view).unmount());
  view = undefined;
  expect(session.release).toHaveBeenCalledTimes(1);
  await act(async () => {
    erased.resolve();
    await clearing;
  });
  expect(session.release).toHaveBeenCalledTimes(1);
  expect(home).not.toHaveBeenCalled();
});

test('failed temporary erase reports the command failure without poisoning successful release custody', async () => {
  const initial = nativeSession('initial');
  const temporary = nativeSession('temporary');
  const replacement = nativeSession('replacement');
  temporary.eraseResults.mockRejectedValueOnce({ code: 'storageUnavailable' });
  mockCreate
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(temporary)
    .mockResolvedValueOnce(replacement);
  await mount(durable);
  await act(async () => required(workspace).recovery.clear('passport'));
  expect(temporary.eraseResults).toHaveBeenCalledTimes(1);
  expect(temporary.release).toHaveBeenCalledTimes(1);
  expect(required(workspace).recovery.clearFailure?.target).toBe('passport');
  expect(home).not.toHaveBeenCalled();
  await expect(owner.releasing).resolves.toBeDefined();
  await act(async () => required(view).update(<Harness key="replacement" configuration={{ ...durable }} />));
  expect(mockCreate).toHaveBeenCalledTimes(3);
  expect(replacement.listResults).toHaveBeenCalledTimes(1);
});

test('guided license start waits for workspace restoration and admits repeated taps only once', async () => {
  await mount({ document: documentConfiguration });
  const session = nativeSession('guided');
  const snapshot = await session.documentCheckRestore();
  const restoration = deferred<typeof snapshot>();
  session.documentCheckRestore.mockReturnValueOnce(restoration.promise);
  await adopt(session);
  navigate.mockClear();
  await act(async () => {
    required(workspace).license.start('front', true);
    required(workspace).license.start('front', true);
  });
  expect(navigate).not.toHaveBeenCalled();
  expect(required(workspace).license.result?.session).toBe(session);
  await act(async () => {
    restoration.resolve(snapshot);
    await settle();
  });
  expect(navigate.mock.calls).toEqual([['license', true]]);
  expect(required(workspace).license.input.saved?.session).toBe(session);
});

test('abandoned guided start cannot navigate after its workspace restore settles', async () => {
  await mount({ document: documentConfiguration });
  const session = nativeSession('abandoned-guided');
  const snapshot = await session.documentCheckRestore();
  const restoration = deferred<typeof snapshot>();
  session.documentCheckRestore.mockReturnValueOnce(restoration.promise);
  await adopt(session);
  navigate.mockClear();
  required(workspace).license.start('front', true);
  await act(async () => view?.unmount());
  view = undefined;
  await act(async () => {
    restoration.resolve(snapshot);
    await settle();
  });
  expect(navigate).not.toHaveBeenCalled();
  expect(session.release).toHaveBeenCalledTimes(1);
});
