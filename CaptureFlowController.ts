import type {
  CaptureErrorCode,
  CaptureEvent,
  CaptureSession,
  CompletedResultDescriptor,
  Configuration,
  FaceComparison,
  MRZObservation,
  PassportObservation,
  PassportReadOptions,
} from '@kenshiki/identity-capture';
import { type ErrorText, errorCode, errorText } from './HolderText';
import { t } from './locales/i18n';

// Host orchestration only. All parsing, acquisition, liveness and comparison use public SDK APIs.
export type Phase =
  | 'loading'
  | 'saved'
  | 'intro'
  | 'scanning'
  | 'review'
  | 'reading'
  | 'passport'
  | 'selfie'
  | 'captured'
  | 'comparing'
  | 'result';
type Recovery = 'load' | 'save' | 'scan' | 'read' | 'selfie' | 'compare' | 'dismiss' | 'settings' | 'details';
export type FlowState = {
  saved?: CompletedResultDescriptor[] | undefined;
  phase: Phase;
  busy: boolean;
  preview: number;
  ready: boolean;
  session?: CaptureSession | undefined;
  mrz?: MRZObservation | undefined;
  passport?: PassportObservation | undefined;
  passportMRZ?: MRZObservation | undefined;
  comparison?: FaceComparison | undefined;
  hint?: string | undefined;
  progress?: string | undefined;
  sheet?: { kind: 'recovery' | 'restart'; message: string; recovery: Recovery } | undefined;
};
/** The receiving app owns this review session. Configured encrypted results survive its release. */
export type CompletedCapture = {
  session: CaptureSession;
  mrz?: MRZObservation | undefined;
  passport: PassportObservation;
  comparison?: FaceComparison | undefined;
};
const initial = (): FlowState => ({ phase: 'intro', busy: false, preview: 0, ready: false });
/** Templates for the system NFC sheet, which fills in `{progress}` itself as the read advances. */
const messages: PassportReadOptions['messages'] = {
  presenting: t('passport.nfc.presenting'),
  authenticating: t('passport.nfc.authenticating', { progress: '{progress}' }),
  reading: t('passport.nfc.reading', { progress: '{progress}' }),
  activeAuthentication: t('passport.nfc.activeAuthentication'),
  transportFinishing: t('passport.nfc.transportFinishing'),
  failure: t('passport.nfc.failure'),
};
const errors: ErrorText = {
  cameraUnavailable: t('passport.error.cameraUnavailable'),
  nfcUnsupported: t('passport.error.nfcUnsupported'),
  cameraPermissionDenied: t('passport.error.cameraPermissionDenied'),
  cameraPermissionRestricted: t('passport.error.cameraPermissionRestricted'),
  trustAnchorsUnavailable: t('passport.error.trustAnchorsUnavailable'),
  trustAnchorNotFound: t('passport.error.trustAnchorNotFound'),
  invalidConfiguration: t('passport.error.invalidConfiguration'),
  passportNotConfigured: t('passport.error.passportNotConfigured'),
  faceComparisonNotConfigured: t('passport.error.faceComparisonNotConfigured'),
  faceModelUnavailable: t('passport.error.faceModelUnavailable'),
  faceComparisonUnavailable: t('passport.error.faceComparisonUnavailable'),
  resultIntegrityFailure: t('passport.error.resultIntegrityFailure'),
  depthEvidenceUnavailable: t('passport.error.depthEvidenceUnavailable'),
  connectionLost: t('passport.error.connectionLost'),
  multipleTags: t('passport.error.multipleTags'),
  passportDataIntegrityFailure: t('passport.error.passportDataIntegrityFailure'),
  invalidAccessKey: t('passport.error.invalidAccessKey'),
  cancelled: t('passport.error.cancelled'),
  depthUnavailable: t('passport.error.depthUnavailable'),
  busy: t('passport.error.busy'),
};
/** Codes with no in-flow remedy; the holder returns to results or Identity. */
const details: CaptureErrorCode[] = [
  'cameraUnavailable',
  'nfcUnsupported',
  'cameraPermissionRestricted',
  'trustAnchorsUnavailable',
  'trustAnchorNotFound',
  'invalidConfiguration',
  'passportNotConfigured',
  'faceComparisonNotConfigured',
  'faceModelUnavailable',
  'faceComparisonUnavailable',
];
const newSelfie: CaptureErrorCode[] = [
  'faceImageUnreadable',
  'noFaceDetected',
  'depthEvidenceUnavailable',
  'selfieUnavailable',
  'comparisonUnavailable',
];
const hints: Record<string, string> = {
  noFaceObserved: t('passport.selfieHint.noFaceObserved'),
  outsideGuide: t('passport.selfieHint.outsideGuide'),
  multipleFacesObserved: t('passport.selfieHint.multipleFacesObserved'),
  eyesClosed: t('passport.selfieHint.eyesClosed'),
  blinkNotObserved: t('passport.selfieHint.blinkNotObserved'),
  blinkExpired: t('passport.selfieHint.blinkExpired'),
  depthFlat: t('passport.selfieHint.depthFlat'),
  depthUnavailable: t('passport.selfieHint.depthUnavailable'),
};

export class CaptureFlowController {
  state: FlowState = initial();
  private epoch = 0;
  private closed = false;
  private off?: (() => void) | undefined;
  private current?: CaptureSession | undefined;
  private pendingComparison = false;
  private activeWork?: Promise<Partial<FlowState>> | undefined;
  private releasing?: Promise<void>;
  private disposal?: Promise<void>;
  constructor(
    private readonly create: (config: Configuration) => Promise<CaptureSession>,
    private readonly config: Configuration,
    private readonly changed: (state: FlowState) => void,
    completed?: CompletedCapture,
  ) {
    if (completed) {
      this.current = completed.session;
      this.state = {
        ...initial(),
        ...completed,
        passportMRZ: completed.mrz,
        phase: completed.comparison ? 'result' : 'passport',
      };
      this.listen(completed.session);
    }
  }
  private update(patch: Partial<FlowState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  open = () => {
    if (this.current || !this.config.results) return Promise.resolve();
    return this.run('loading', 'load', async (session) => {
      const saved = (await session.listResults()).filter((record) => record.kind === 'passport-read-v1');
      const only = saved[0];
      if (saved.length === 1 && only) return this.restore(session, only.workflowID);
      return { saved, phase: saved.length ? 'saved' : 'intro' };
    });
  };
  recoverSaved = (workflowID: string) =>
    this.run('loading', 'load', (session) => this.restore(session, workflowID));
  private async restore(session: CaptureSession, workflowID: string): Promise<Partial<FlowState>> {
    const records = await session.listResults();
    const passport = await session.recoverPassport(workflowID);
    const face = records.find(
      (record) => record.workflowID === workflowID && record.kind === 'face-comparison-v1',
    );
    // An earlier face result must never be shown against a replacement passport photo.
    const comparison = face?.artifacts.some(
      (artifact) => artifact.role === 'reference' && artifact.sha256 === passport.portraitSHA256,
    )
      ? await session.recoverFace(workflowID)
      : undefined;
    return {
      passport,
      mrz: passport.printedMRZ,
      passportMRZ: passport.printedMRZ,
      comparison,
      phase: comparison ? 'result' : 'passport',
    };
  }
  private recovery(): Recovery {
    switch (this.state.phase) {
      case 'scanning':
        return 'scan';
      case 'reading':
        return 'read';
      case 'selfie':
        return 'selfie';
      case 'comparing':
        return 'selfie';
      default:
        return 'dismiss';
    }
  }
  private async session(epoch: number) {
    if (this.releasing) await this.releasing;
    if (epoch !== this.epoch || this.closed) throw { code: 'cancelled' };
    if (this.current) return this.current;
    const session = await this.create(this.config);
    if (epoch !== this.epoch || this.closed) {
      await session.release();
      throw { code: 'cancelled' };
    }
    this.current = session;
    this.listen(session);
    this.update({ session });
    return session;
  }
  private listen(session: CaptureSession) {
    this.off = session.subscribe(
      (event) => {
        if (!this.closed && this.current === session && !this.state.sheet) this.event(event);
      },
      (error) => {
        if (!this.closed && this.current === session) this.fail(error);
      },
    );
  }
  private acceptCompletion(epoch: number, session: CaptureSession, patch: Partial<FlowState>) {
    if (epoch === this.epoch && !this.closed) this.update(patch);
    else if (!this.closed && this.current === session && ('passport' in patch || 'comparison' in patch)) {
      // Native completion can win before cancel while its Promise is still crossing the
      // bridge. Reconcile committed evidence, without reopening the interrupted screen.
      const { phase: _phase, ...evidence } = patch;
      this.update(evidence);
      const sheet = this.state.sheet;
      if (sheet)
        this.update({
          sheet: {
            ...sheet,
            recovery: 'details',
            message: sheet.kind === 'recovery' ? t('passport.message.completed') : sheet.message,
          },
        });
    }
  }
  private commandFailure(error: unknown, phase: Phase, recovery: Recovery) {
    const code = errorCode(error);
    if (code === 'cancelled' && phase === 'reading') {
      this.update({
        phase: this.resultsPhase(),
        mrz: this.state.passportMRZ ?? this.state.mrz,
        progress: undefined,
        sheet: undefined,
      });
      return;
    }
    const next = code === 'resultSaveFailed' ? 'save' : this.errorRecovery(code, recovery);
    this.update({
      ready: false,
      sheet: {
        kind: 'recovery',
        recovery: next,
        message:
          code === 'resultSaveFailed'
            ? t('passport.message.saveFailed')
            : errorText(code, errors, t('passport.message.other')),
      },
    });
  }
  private async run(
    phase: Phase,
    recovery: Recovery,
    work: (session: CaptureSession) => Promise<Partial<FlowState>>,
  ) {
    if (this.closed || this.state.busy) return;
    const epoch = ++this.epoch;
    this.update({ phase, busy: true, sheet: undefined });
    let pending: Promise<Partial<FlowState>> | undefined;
    try {
      const session = await this.session(epoch);
      if (epoch !== this.epoch || this.closed) return;
      pending = work(session);
      this.activeWork = pending;
      const patch = await pending;
      this.acceptCompletion(epoch, session, patch);
    } catch (error) {
      if (epoch === this.epoch && !this.closed) {
        this.commandFailure(error, phase, recovery);
      }
    } finally {
      if (this.activeWork === pending) this.activeWork = undefined;
      if (epoch === this.epoch) {
        this.update({ busy: false });
        this.compareWhenReady();
      }
    }
  }
  scan = () => {
    if (!this.state.busy) this.update({ mrz: undefined, ready: false });
    return this.run('scanning', 'scan', async (session) => {
      await session.startMRZ(true);
      return {};
    });
  };
  review = () =>
    this.run('scanning', 'scan', async (session) => ({ mrz: await session.captureMRZ(), phase: 'review' }));
  read = () =>
    this.run('reading', 'read', async (session) => {
      const mrz = this.state.mrz;
      if (!mrz) throw { code: 'invalidAccessKey' };
      this.update({ progress: t('passport.progress.connecting') });
      return {
        passport: await session.readPassport({ ...mrz, consent: true, messages }),
        passportMRZ: mrz,
        comparison: undefined,
        phase: 'passport',
      };
    });
  selfie = () => {
    if (this.closed || this.state.busy) return Promise.resolve();
    if (Object.values(this.state.passport?.correspondence ?? {}).includes('differs')) {
      this.update({
        sheet: { kind: 'recovery', recovery: 'scan', message: t('passport.message.correspondenceDiffers') },
      });
      return Promise.resolve();
    }
    this.update({ ready: false, hint: t('passport.selfieHint.start') });
    return this.run('selfie', 'selfie', async (session) => {
      await session.startSelfie(true);
      return {};
    });
  };
  capture = () =>
    this.run('selfie', 'selfie', async (session) => {
      await session.captureSelfie();
      return {};
    });
  compare = () =>
    this.run('comparing', 'selfie', async (session) => ({
      comparison: await session.compareFace(),
      phase: 'result',
    }));
  recover = () => {
    if (this.state.busy) return Promise.resolve();
    const recovery = this.state.sheet?.recovery;
    this.update({ sheet: undefined });
    switch (recovery) {
      case 'load':
        return this.run('loading', 'load', async (session) => {
          const saved = (await session.listResults()).filter((record) => record.kind === 'passport-read-v1');
          return { saved, phase: saved.length ? 'saved' : 'intro' };
        });
      case 'save':
        return this.run(this.state.phase, 'save', async (session) => {
          const saved = await session.retryResultSave();
          return 'documentNumber' in saved
            ? {
                passport: saved,
                mrz: saved.printedMRZ,
                passportMRZ: saved.printedMRZ,
                comparison: undefined,
                phase: 'passport',
              }
            : { comparison: saved, phase: 'result' };
        });
      case 'scan':
        return this.scan();
      case 'read':
        return this.read();
      case 'selfie':
        return this.selfie();
      case 'compare':
        return this.compare();
      case 'settings':
        return this.state.phase === 'selfie' ? this.selfie() : this.scan();
      case 'details':
        this.update({ phase: this.resultsPhase(), mrz: this.state.passportMRZ ?? this.state.mrz });
        return Promise.resolve();
      default:
        return Promise.resolve();
    }
  };
  private resultsPhase(): Phase {
    return this.state.passport
      ? this.state.comparison
        ? 'result'
        : 'passport'
      : this.state.mrz
        ? 'review'
        : 'intro';
  }
  private errorRecovery(code: CaptureErrorCode | undefined, fallback: Recovery): Recovery {
    if (code === undefined) return fallback;
    if (code === 'cameraPermissionDenied') return 'settings';
    if (details.includes(code)) return 'details';
    if (code === 'invalidAccessKey') return 'scan';
    if (newSelfie.includes(code)) return 'selfie';
    if (code === 'invalidReference' || code === 'referenceUnavailable') return 'read';
    return fallback;
  }
  private async interrupt(sheet: NonNullable<FlowState['sheet']>) {
    const epoch = ++this.epoch;
    this.pendingComparison = false;
    this.update({ busy: true, ready: false, sheet });
    const pending = this.activeWork;
    try {
      await Promise.allSettled([this.current?.cancel(), pending]);
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
  pause = () => {
    if (this.closed || this.state.sheet || (!this.state.busy && this.recovery() === 'dismiss'))
      return Promise.resolve();
    return this.interrupt({
      kind: 'recovery',
      recovery: this.recovery(),
      message: t('passport.message.paused'),
    });
  };
  requestRestart = () =>
    this.interrupt({ kind: 'restart', recovery: this.recovery(), message: t('passport.message.restart') });
  restart = async () => {
    if (this.closed || this.state.busy) return;
    const epoch = ++this.epoch;
    this.pendingComparison = false;
    this.update({ busy: true });
    this.off?.();
    this.off = undefined;
    const old = this.current;
    this.current = undefined;
    this.releasing = this.release(old);
    try {
      await this.releasing;
      if (epoch === this.epoch && !this.closed) {
        this.state = initial();
        this.changed(this.state);
      }
    } catch (error) {
      if (!this.closed) {
        // Native custody is already revoked. A failed cleanup cannot authorize a new check.
        this.state = {
          ...initial(),
          sheet: { kind: 'recovery', recovery: 'details', message: t('common.sessionRecovery') },
        };
        this.closed = true;
        this.changed(this.state);
      }
      throw error;
    }
  };
  private release(session: CaptureSession | undefined): Promise<void> {
    const release = Promise.resolve().then(() => session?.release());
    return Promise.allSettled([release, this.releasing, this.activeWork]).then(
      ([released, previousRelease]) => {
        if (released.status === 'rejected') throw released.reason;
        if (previousRelease.status === 'rejected') throw previousRelease.reason;
      },
    );
  }
  dispose = (): Promise<void> => {
    if (this.disposal) return this.disposal;
    this.pendingComparison = false;
    this.closed = true;
    ++this.epoch;
    this.off?.();
    this.off = undefined;
    const old = this.current;
    this.current = undefined;
    this.state = initial();
    this.disposal = this.release(old);
    return this.disposal;
  };
  /** Drain acquisition before transferring its retained evidence. Until that succeeds this
   * controller still owns the session, so disposal can revoke an interrupted handoff. */
  handoff = async (): Promise<CompletedCapture> => {
    if (this.closed || !this.current || !this.state.passport) {
      throw new Error(t('passport.handoffNotReady'));
    }
    const session = this.current;
    ++this.epoch;
    this.pendingComparison = false;
    this.update({ busy: true, ready: false });
    const [cancelled] = await Promise.allSettled([session.cancel(), this.activeWork]);
    if (this.closed || this.current !== session) throw { code: 'cancelled' };
    if (cancelled.status === 'rejected') {
      this.update({ busy: false });
      throw cancelled.reason;
    }
    if (!this.state.passport) throw new Error(t('passport.handoffNotReady'));
    const result = {
      session,
      mrz: this.state.passportMRZ,
      passport: this.state.passport,
      comparison: this.state.comparison,
    };
    this.closed = true;
    ++this.epoch;
    this.pendingComparison = false;
    this.off?.();
    this.off = undefined;
    this.current = undefined;
    this.state = initial();
    return result;
  };
  fail = (error: unknown) => {
    const code = errorCode(error);
    this.update({
      busy: false,
      ready: false,
      sheet: {
        kind: 'recovery',
        recovery: this.errorRecovery(code, this.recovery()),
        message: errorText(code, errors, t('passport.message.other')),
      },
    });
  };
  private compareWhenReady() {
    if (this.pendingComparison && !this.closed && !this.state.busy && !this.state.sheet) {
      this.pendingComparison = false;
      this.compare().catch(this.fail);
    }
  }
  private showPassportProgress(event: Extract<CaptureEvent, { type: 'passportProgress' }>) {
    const checking = ['transportComplete', 'passiveAuthentication'].includes(event.stage);
    const percent =
      event.progress != null && Number.isFinite(event.progress)
        ? Math.round(Math.max(0, Math.min(100, event.progress)))
        : undefined;
    const group = event.group && /^(DG\d{1,2}|SOD|COM)$/.test(event.group) ? event.group : undefined;
    const shown = {
      hasGroup: group === undefined ? 'no' : 'yes',
      group: group ?? '',
      hasPercent: percent === undefined ? 'no' : 'yes',
      percent: percent ?? 0,
    };
    this.update({
      progress: checking
        ? t('passport.progress.checking')
        : event.stage === 'reading'
          ? t('passport.progress.reading', shown)
          : event.stage === 'authenticating'
            ? t('passport.progress.authenticating', shown)
            : t('passport.progress.waiting'),
    });
  }
  private event(event: CaptureEvent) {
    if (event.type === 'mrzObservation' && this.state.phase === 'scanning') {
      this.update({ mrz: event.observation });
    } else if (event.type === 'passportProgress' && this.state.phase === 'reading') {
      this.showPassportProgress(event);
    } else if (event.type === 'previewChanged' && this.state.phase === 'selfie') {
      this.update({ preview: this.state.preview + 1 });
    } else if (event.type === 'selfieReadiness' && this.state.phase === 'selfie') {
      this.update({
        ready: event.permitsCapture,
        hint: event.permitsCapture
          ? t('passport.selfieHint.ready')
          : (hints[event.reason ?? ''] ?? t('passport.selfieHint.other')),
      });
    } else if (event.type === 'selfieCaptured' && this.state.phase === 'selfie') {
      this.update({ phase: 'captured', ready: false });
      this.pendingComparison = true;
      this.compareWhenReady();
    } else if (
      event.type === 'failure' &&
      ((event.capability === 'mrz' && this.state.phase === 'scanning') ||
        (event.capability === 'selfie' && this.state.phase === 'selfie'))
    ) {
      // Capture failure events carry the same closed vocabulary as command rejections.
      const code = event.code;
      this.interrupt({
        kind: 'recovery',
        recovery: this.errorRecovery(code, this.recovery()),
        message: errorText(code, errors, t('passport.message.cameraStopped')),
      }).catch(this.fail);
    }
  }
}
