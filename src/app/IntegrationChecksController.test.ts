import type { CaptureEvent, CaptureSession, Configuration, MRZObservation } from '@kenshiki/identity-capture';
import { documentConfiguration } from '../testing/documentFixture';
import { mockSession as makeSession, settle } from '../testing/support';
import { IntegrationChecksController } from './IntegrationChecksController';
import { t } from '../locales/i18n';

const parsed: MRZObservation = {
  documentNumber: 'X1234567',
  completeness: 'complete',
  missingFields: [],
  normalizedLines: [],
  birthDateYYMMDD: '850615',
  expiryDateYYMMDD: '320101',
  surname: 'SPECIMEN',
  givenNames: 'SYNTHETIC',
  nationality: 'UTO',
  issuingState: 'UTO',
  sex: 'F',
};
const configuration: Configuration = {
  results: { directoryURL: 'file:///results', keychainService: 'results', keychainAccount: 'holder' },
  document: documentConfiguration,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  return { promise, resolve, reject };
}
function fixture() {
  let listener!: (event: CaptureEvent) => void;
  let released = false;
  const unsubscribe = jest.fn();
  const preview = makeSession({ id: 'preview', release: jest.fn(async () => {}) });
  const primary = makeSession({
    id: 'primary',
    listResults: jest.fn(async () => []),
    eraseResults: jest.fn(async () => {}),
    documentCheckRestore: jest.fn(async () => {
      throw { code: 'documentFrontRequired' };
    }),
    parseMRZ: jest.fn(async (lines: string[][]) => {
      if (released) throw { code: 'sessionUnavailable' };
      if (lines[1]?.[0]?.endsWith('9')) throw { code: 'incompleteMRZ' };
      return parsed;
    }),
    captureMRZ: jest.fn(async () => {
      throw { code: 'incompleteMRZ' };
    }),
    compareFace: jest.fn(async () => {
      throw { code: 'referenceUnavailable' };
    }),
    ssnSnapshot: jest.fn(async () => {
      throw { code: 'ssnNotConfigured' };
    }),
    ssnCancel: jest.fn(async () => {
      throw { code: 'ssnNotConfigured' };
    }),
    phoneSnapshot: jest.fn(async () => {
      throw { code: 'phoneNotConfigured' };
    }),
    phoneCancel: jest.fn(async () => {
      throw { code: 'phoneNotConfigured' };
    }),
    readPassport: jest.fn(async () => {
      throw { code: 'passportNotConfigured' };
    }),
    subscribe: jest.fn((next: (event: CaptureEvent) => void) => {
      listener = next;
      return unsubscribe;
    }),
    startSelfie: jest.fn(async () => {
      listener({ type: 'failure', capability: 'selfie', code: 'cameraUnavailable' });
    }),
    cancel: jest.fn(async () => {}),
    release: jest.fn(async () => {
      released = true;
    }),
  });
  const secondary = makeSession({
    id: 'secondary',
    listResults: jest.fn(async () => {
      throw { code: 'resultsNotConfigured' };
    }),
    parseMRZ: jest.fn(async (lines: string[][]) =>
      lines.length === 1
        ? { ...parsed, completeness: 'partial' as const, missingFields: ['name' as const] }
        : parsed,
    ),
    release: jest.fn(async () => {}),
  });
  const create = jest
    .fn<Promise<CaptureSession>, [Configuration?]>()
    .mockResolvedValueOnce(preview)
    .mockRejectedValueOnce({ code: 'invalidConfiguration' })
    .mockResolvedValueOnce(primary)
    .mockResolvedValueOnce(secondary);
  const changed = jest.fn();
  const controller = new IntegrationChecksController(create, configuration, changed);
  return { controller, create, changed, preview, primary, secondary, unsubscribe };
}

test('all original diagnostics run once in isolated stores and pass only after cleanup', async () => {
  const f = fixture();
  const release = deferred<void>();
  f.secondary.release.mockImplementationOnce(() => release.promise);
  await f.controller.open();
  const running = f.controller.run();
  const duplicate = f.controller.run();
  expect(duplicate).toBe(running);
  for (let n = 0; n < 10; n++) await settle();
  expect(f.controller.state.results).toHaveLength(19);
  expect(f.controller.state.results.map((result) => result.label)).toEqual([
    'invalidConfiguration',
    t('developer.check.independentSessions'),
    'resultsNotConfigured',
    t('developer.check.emptyResults'),
    'documentFrontRequired',
    t('developer.check.resultErasure'),
    t('developer.check.mrzParser'),
    t('developer.check.partialRead'),
    'incompleteMRZ',
    'incompleteMRZ',
    'referenceUnavailable',
    'ssnNotConfigured',
    'ssnNotConfigured',
    'phoneNotConfigured',
    'phoneNotConfigured',
    'passportNotConfigured',
    t('developer.check.cameraFailsClosed'),
    'sessionUnavailable',
    t('developer.check.releaseIsolation'),
  ]);
  expect(new Set(f.controller.state.results.map((result) => result.id)).size).toBe(19);
  expect(f.controller.state.busy).toBe(true);
  expect(f.controller.state.status).toBe(t('developer.status.running'));
  expect(f.create).toHaveBeenCalledTimes(4);
  expect(f.create).toHaveBeenNthCalledWith(3, {
    results: {
      ...configuration.results,
      directoryURL: 'file:///results-integration-checks',
      keychainService: 'results.integration-checks',
    },
    document: {
      ...documentConfiguration,
      directoryURL: `${documentConfiguration.directoryURL}-integration-checks`,
      keychainService: `${documentConfiguration.keychainService}.integration-checks`,
    },
  });
  expect(f.primary.startSelfie).toHaveBeenCalledWith(true);
  expect(f.primary.cancel).toHaveBeenCalledTimes(1);
  expect(f.primary.release).toHaveBeenCalledTimes(1);
  expect(f.secondary.parseMRZ).toHaveBeenCalledTimes(2);
  release.resolve();
  await running;
  expect(f.controller.state.status).toBe(t('developer.status.passed', { count: 19 }));
  expect(f.preview.release).not.toHaveBeenCalled();
  await f.controller.dispose();
  expect(f.preview.release).toHaveBeenCalledTimes(1);
  expect(f.secondary.release).toHaveBeenCalledTimes(1);
});

test('failed primary release still releases secondary and prevents rerun or successful disposal', async () => {
  const f = fixture();
  const failure = new Error('cleanup failed');
  f.primary.release.mockRejectedValueOnce(failure);
  await f.controller.open();
  await f.controller.run();
  expect(f.secondary.release).toHaveBeenCalledTimes(1);
  expect(f.controller.state.releaseFailed).toBe(true);
  expect(f.controller.state.busy).toBe(false);
  expect(f.controller.state.status).toBe(t('developer.status.releaseFailed'));
  await f.controller.run();
  expect(f.create).toHaveBeenCalledTimes(4);
  await expect(f.controller.dispose()).rejects.toBe(failure);
  await expect(f.controller.dispose()).rejects.toBe(failure);
  expect(f.primary.release).toHaveBeenCalledTimes(1);
  expect(f.preview.release).toHaveBeenCalledTimes(1);
});

test('unexpected successful invalid-configuration probe is owned and released', async () => {
  const f = fixture();
  const unexpected = makeSession({ release: jest.fn(async () => {}) });
  f.create.mockReset().mockResolvedValueOnce(f.preview).mockResolvedValueOnce(unexpected);
  await f.controller.open();
  await f.controller.run();
  expect(unexpected.release).toHaveBeenCalledTimes(1);
  expect(f.controller.state.status).toContain('invalidConfiguration');
  expect(f.create).toHaveBeenCalledTimes(2);
  await f.controller.dispose();
});

test.each([false, true])(
  'late acquisition drains on disposal without publishing or starting checks (release fails: %s)',
  async (fails) => {
    const f = fixture();
    await f.controller.open();
    const acquisition = deferred<CaptureSession>();
    f.create
      .mockReset()
      .mockRejectedValueOnce({ code: 'invalidConfiguration' })
      .mockReturnValueOnce(acquisition.promise);
    const running = f.controller.run();
    await settle();
    const failure = new Error('late cleanup failed');
    if (fails) f.primary.release.mockRejectedValueOnce(failure);
    const count = f.changed.mock.calls.length;
    let disposed = false;
    const closing = f.controller.dispose().then(
      () => {
        disposed = true;
        return undefined;
      },
      (error: unknown) => {
        disposed = true;
        return error;
      },
    );
    await settle();
    expect(disposed).toBe(false);
    acquisition.resolve(f.primary);
    expect(await closing).toBe(fails ? failure : undefined);
    await running;
    expect(f.primary.listResults).not.toHaveBeenCalled();
    expect(f.create).toHaveBeenCalledTimes(2);
    expect(f.primary.release).toHaveBeenCalledTimes(1);
    expect(f.changed).toHaveBeenCalledTimes(count);
  },
);

test('disposal drains an active command and never issues the following diagnostic', async () => {
  const f = fixture();
  const results = deferred<[]>();
  f.primary.listResults.mockImplementationOnce(() => results.promise);
  await f.controller.open();
  const running = f.controller.run();
  for (let n = 0; n < 3; n++) await settle();
  expect(f.primary.listResults).toHaveBeenCalledTimes(1);
  let disposed = false;
  const closing = f.controller.dispose().then(() => {
    disposed = true;
  });
  await settle();
  expect(disposed).toBe(false);
  expect(f.primary.release).toHaveBeenCalledTimes(1);
  expect(f.secondary.release).toHaveBeenCalledTimes(1);
  results.resolve([]);
  await closing;
  await running;
  expect(f.primary.documentCheckRestore).not.toHaveBeenCalled();
});

test.each(['command rejection', 'timeout', 'dispose'] as const)(
  'camera observer settles and unsubscribes after %s',
  async (path) => {
    jest.useFakeTimers();
    const f = fixture();
    f.primary.startSelfie.mockImplementationOnce(async () => {
      if (path === 'command rejection') throw { code: 'cameraUnavailable' };
    });
    try {
      await f.controller.open();
      const running = f.controller.run();
      for (let n = 0; n < 10; n++) await settle();
      expect(f.primary.startSelfie).toHaveBeenCalledTimes(1);
      if (path === 'timeout') jest.advanceTimersByTime(5000);
      if (path === 'dispose') await f.controller.dispose();
      await running;
      expect(f.unsubscribe).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      expect(f.primary.cancel).not.toHaveBeenCalled();
      expect(f.primary.release).toHaveBeenCalledTimes(1);
      expect(f.secondary.release).toHaveBeenCalledTimes(1);
      await f.controller.dispose();
    } finally {
      jest.useRealTimers();
    }
  },
);

test('preview acquisition failure is presented without an unhandled open rejection', async () => {
  const f = fixture();
  f.create.mockReset().mockRejectedValueOnce({ code: 'invalidConfiguration' });
  await expect(f.controller.open()).resolves.toBeUndefined();
  expect(f.controller.state.opening).toBe(false);
  expect(f.controller.state.status).toContain('invalidConfiguration');
  await f.controller.dispose();
});

jest.mock('@kenshiki/identity-capture', () => ({
  isCaptureErrorCode: jest.requireActual<typeof import('@kenshiki/identity-capture/src/codes')>(
    '@kenshiki/identity-capture/src/codes',
  ).isCaptureErrorCode,
}));
