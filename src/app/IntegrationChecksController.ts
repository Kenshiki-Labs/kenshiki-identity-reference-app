import type { CaptureErrorCode, CaptureSession, Configuration } from '@kenshiki/identity-capture';
import { CaptureFlowError } from '../identity/CaptureFlowError';
import { errorCode } from './HolderText';
import { t } from '../locales/i18n';

export type IntegrationChecksState = {
  session: CaptureSession | undefined;
  status: string;
  results: { id: string; label: string }[];
  busy: boolean;
  opening: boolean;
  releaseFailed: boolean;
};
export const initialIntegrationChecksState: IntegrationChecksState = {
  session: undefined,
  status: t('developer.status.ready'),
  results: [],
  busy: false,
  opening: true,
  releaseFailed: false,
};
const rows: [[string], [string]] = [
  ['P<UTOSPECIMEN<<SYNTHETIC<<<<<<<<<<<<<<<<<<<<'],
  ['X1234567<7UTO8506151F3201015<<<<<<<<<<<<<<08'],
];
const messages = {
  presenting: t('developer.nfc.presenting'),
  authenticating: t('developer.nfc.authenticating', { progress: '{progress}' }),
  reading: t('developer.nfc.reading', { group: '{group}', progress: '{progress}' }),
  activeAuthentication: t('developer.nfc.activeAuthentication'),
  transportFinishing: t('developer.nfc.transportFinishing'),
  failure: t('developer.nfc.failure'),
};
const isolated = <T extends { directoryURL: string; keychainService: string }>(value: T): T => ({
  ...value,
  directoryURL: `${value.directoryURL}-integration-checks`,
  keychainService: `${value.keychainService}.integration-checks`,
});

/** Simulator Debug diagnostics own separate sessions and isolated stores, including failed probes. */
export class IntegrationChecksController {
  state: IntegrationChecksState = { ...initialIntegrationChecksState };
  private closed = false;
  private opening: Promise<void> | undefined;
  private running: Promise<void> | undefined;
  private disposal: Promise<void> | undefined;
  private readonly sessions = new Set<CaptureSession>();
  private readonly acquisitions = new Set<Promise<CaptureSession>>();
  private readonly releases = new Map<CaptureSession, Promise<void>>();
  private stopCamera: (() => void) | undefined;
  constructor(
    private readonly create: (configuration?: Configuration) => Promise<CaptureSession>,
    private readonly configuration: Configuration,
    private readonly changed: (state: IntegrationChecksState) => void,
  ) {}
  private update(patch: Partial<IntegrationChecksState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  private assertOpen() {
    if (this.closed) throw new CaptureFlowError('cancelled');
  }
  private acquire(configuration?: Configuration) {
    this.assertOpen();
    const pending = Promise.resolve()
      .then(() => {
        this.assertOpen();
        return this.create(configuration);
      })
      .then(async (session) => {
        this.sessions.add(session);
        if (this.closed) {
          await this.release(session);
          this.assertOpen();
        }
        return session;
      });
    this.acquisitions.add(pending);
    const finished = () => {
      this.acquisitions.delete(pending);
    };
    pending.then(finished, finished);
    return pending;
  }
  private release(session: CaptureSession) {
    let pending = this.releases.get(session);
    if (!pending) {
      pending = Promise.resolve().then(() => session.release());
      this.releases.set(session, pending);
      // Retain failures for custody, while observing them immediately during concurrent cleanup.
      pending.catch(() => this.update({ releaseFailed: true, status: t('developer.status.releaseFailed') }));
    }
    return pending;
  }
  private async releaseAll(sessions: Iterable<CaptureSession>) {
    const settled = await Promise.allSettled([...sessions].map((session) => this.release(session)));
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  open = (): Promise<void> => {
    if (this.closed) return Promise.resolve();
    if (this.opening !== undefined) return this.opening;
    this.opening = this.acquire().then(
      (session) => this.update({ session, opening: false }),
      (error: unknown) =>
        this.update({
          opening: false,
          status: t('developer.status.createFailed', { code: errorCode(error) ?? t('developer.noCode') }),
        }),
    );
    return this.opening;
  };
  run = (): Promise<void> => {
    if (this.closed || this.state.opening || this.state.releaseFailed) return Promise.resolve();
    if (this.running !== undefined) return this.running;
    if (this.state.busy) return Promise.resolve();
    this.update({ busy: true, results: [], status: t('developer.status.running') });
    this.running = this.performRun();
    const finished = () => {
      this.running = undefined;
    };
    this.running.then(finished, finished);
    return this.running;
  };
  private async performRun() {
    const checks: string[] = [];
    let status: string;
    try {
      await this.checks(checks);
      status = t('developer.status.passed', { count: checks.length });
    } catch (error) {
      status = t('developer.status.failed', {
        message: error instanceof Error ? error.message : t('developer.nativeCommandFailed'),
      });
    }
    try {
      await this.releaseAll([...this.sessions].filter((session) => session !== this.state.session));
    } catch {
      this.update({ busy: false, releaseFailed: true, status: t('developer.status.releaseFailed') });
      return;
    }
    this.update({ busy: false, status });
  }
  private async step<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const result = await operation();
    this.assertOpen();
    return result;
  }
  private check(checks: string[], condition: boolean, name: string) {
    this.assertOpen();
    if (!condition) throw new Error(name);
    checks.push(name);
    this.update({ results: [...this.state.results, { id: `check-${checks.length}`, label: name }] });
  }
  private async rejects(checks: string[], operation: () => Promise<unknown>, code: CaptureErrorCode) {
    try {
      await this.step(operation);
    } catch (error) {
      this.check(checks, errorCode(error) === code, code);
      return;
    }
    throw new Error(t('developer.expected', { code }));
  }
  private async checks(checks: string[]) {
    const check = (condition: boolean, name: string) => this.check(checks, condition, name);
    const rejects = (operation: () => Promise<unknown>, code: CaptureErrorCode) =>
      this.rejects(checks, operation, code);
    await rejects(
      () => this.acquire({ trustAnchorsURL: 'file:///missing-test-anchors.pem' }),
      'invalidConfiguration',
    );
    const primary = await this.acquire({
      ...(this.configuration.results ? { results: isolated(this.configuration.results) } : {}),
      ...(this.configuration.document ? { document: isolated(this.configuration.document) } : {}),
    });
    const secondary = await this.acquire();
    check(primary.id !== secondary.id, t('developer.check.independentSessions'));
    await rejects(() => secondary.listResults(), 'resultsNotConfigured');
    check((await this.step(() => primary.listResults())).length === 0, t('developer.check.emptyResults'));
    await rejects(
      () => primary.documentCheckRestore(),
      this.configuration.document?.check ? 'documentFrontRequired' : 'documentCheckNotConfigured',
    );
    await this.step(() => primary.eraseResults());
    check((await this.step(() => primary.listResults())).length === 0, t('developer.check.resultErasure'));
    const parsed = await this.step(() => primary.parseMRZ(rows));
    check(
      parsed.documentNumber === 'X1234567' && parsed.completeness === 'complete',
      t('developer.check.mrzParser'),
    );
    const partial = await this.step(() => secondary.parseMRZ([rows[1]]));
    check(
      partial.completeness === 'partial' && partial.missingFields.includes('name'),
      t('developer.check.partialRead'),
    );
    await rejects(() => primary.parseMRZ([[rows[0][0]], [`${rows[1][0].slice(0, 43)}9`]]), 'incompleteMRZ');
    await rejects(() => primary.captureMRZ(), 'incompleteMRZ');
    await rejects(() => primary.compareFace(), 'referenceUnavailable');
    await rejects(() => primary.ssnSnapshot(), 'ssnNotConfigured');
    await rejects(() => primary.ssnCancel(), 'ssnNotConfigured');
    await rejects(() => primary.phoneSnapshot(), 'phoneNotConfigured');
    await rejects(() => primary.phoneCancel(), 'phoneNotConfigured');
    await rejects(
      () => primary.readPassport({ ...parsed, consent: true, messages }),
      'passportNotConfigured',
    );
    check(
      (await this.cameraFailure(primary)) === 'cameraUnavailable',
      t('developer.check.cameraFailsClosed'),
    );
    await this.step(() => primary.cancel());
    await this.step(() => this.release(primary));
    await rejects(() => primary.parseMRZ(rows), 'sessionUnavailable');
    check(
      (await this.step(() => secondary.parseMRZ(rows))).documentNumber === 'X1234567',
      t('developer.check.releaseIsolation'),
    );
  }
  private async cameraFailure(session: CaptureSession) {
    this.assertOpen();
    let finish!: (value: { code: CaptureErrorCode } | { error: unknown }) => void;
    const outcome = new Promise<{ code: CaptureErrorCode } | { error: unknown }>((resolve) => {
      finish = resolve;
    });
    const timer = setTimeout(() => finish({ error: new Error(t('developer.missingCameraFailure')) }), 5000);
    let off: (() => void) | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      const unsubscribe = off;
      off = undefined;
      unsubscribe?.();
    };
    this.stopCamera = () => {
      cleanup();
      finish({ error: new CaptureFlowError('cancelled') });
    };
    try {
      off = session.subscribe(
        (event) => {
          if (event.type === 'failure' && event.capability === 'selfie') finish({ code: event.code });
        },
        (error) => finish({ error }),
      );
      await this.step(() => session.startSelfie(true));
      const result = await outcome;
      this.assertOpen();
      if ('error' in result) throw result.error;
      return result.code;
    } finally {
      cleanup();
      this.stopCamera = undefined;
    }
  }
  dispose = (): Promise<void> => {
    if (this.disposal !== undefined) return this.disposal;
    this.closed = true;
    this.stopCamera?.();
    this.disposal = this.drain();
    return this.disposal;
  };
  private async drain() {
    // Release known owners immediately, while also waiting for commands and late acquisitions.
    await Promise.allSettled([
      this.releaseAll(this.sessions),
      this.opening,
      this.running,
      ...this.acquisitions,
    ]);
    await this.releaseAll(this.sessions);
  }
}
