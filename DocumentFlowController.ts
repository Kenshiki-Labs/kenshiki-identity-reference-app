import type {
  CaptureErrorCode,
  CaptureEvent,
  CaptureSession,
  Configuration,
  DocumentObservation,
  DocumentRecordSummary,
} from '@kenshiki/identity-capture';
import { CaptureFlowError } from './CaptureFlowError';
import { type ErrorText, errorCode, errorText } from './HolderText';
import { t } from './locales/i18n';
import { SessionAcquisition } from './SessionAcquisition';

export type DocumentSide = 'front' | 'back';
export type SavedDocumentCapture = { session: CaptureSession; document: DocumentObservation };
export type SavedDocumentChoice = { workflowID: string; captureID: string; hasBack: boolean };
type Phase = 'loading' | 'saved' | 'intro' | 'front' | 'frontReview' | 'back' | 'result';
type Recovery = 'front' | 'back' | 'load' | 'recover' | 'snapshot' | 'settings' | 'details';
export type DocumentFlowState = {
  phase: Phase;
  busy: boolean;
  capturing: boolean;
  ready: boolean;
  preview: number;
  session?: CaptureSession | undefined;
  completed?: DocumentObservation | undefined;
  draft?: DocumentObservation | undefined;
  saved: SavedDocumentChoice[];
  selected?: string | undefined;
  issue?: (string | null) | undefined;
  sheet?: { title: string; message: string; recovery: Recovery } | undefined;
};
const initial = (): DocumentFlowState => ({
  phase: 'loading',
  busy: false,
  capturing: false,
  ready: false,
  preview: 0,
  saved: [],
});
type Sheet = NonNullable<DocumentFlowState['sheet']>;
const cameraUnavailable: ErrorText = {
  backCameraUnavailable: t('license.cameraError.backCameraUnavailable'),
  cameraUnavailable: t('license.cameraError.cameraUnavailable'),
  cannotAddCameraInput: t('license.cameraError.cannotAddCameraInput'),
  cannotAddPhotoOutput: t('license.cameraError.cannotAddPhotoOutput'),
  cannotAddVideoOutput: t('license.cameraError.cannotAddVideoOutput'),
};
const captureErrors: ErrorText = {
  locationRequired: t('license.captureError.locationRequired'),
  cameraNotReady: t('license.captureError.cameraNotReady'),
  captureFailed: t('license.captureError.captureFailed'),
  captureQualityNotReady: t('license.captureError.captureQualityNotReady'),
  busy: t('license.captureError.busy'),
  consentRequired: t('license.captureError.consentRequired'),
  recordingTerminated: t('license.captureError.recordingTerminated'),
  nativeControlsPaused: t('license.captureError.nativeControlsPaused'),
};
const storageCodes = new Set<CaptureErrorCode>([
  'documentCustodyFailed',
  'documentIntegrityFailure',
  'documentCheckpointFailed',
  'documentUnavailable',
  'custodyErased',
  'custodyInUse',
  'custodyKeyMissing',
  'custodyKeyInaccessible',
  'custodyErasureRequired',
]);

export const isCompleteDocument = (value?: DocumentObservation) => !!(value?.front && value.back);

/** A scan draft never replaces a completed license until the SDK commits both sides. */
export class DocumentFlowController {
  state = initial();
  private epoch = 0;
  private closed = false;
  private current?: CaptureSession | undefined;
  private off?: (() => void) | undefined;
  private activeWork?: Promise<void> | undefined;
  private readonly acquisition = new SessionAcquisition();
  private disposal?: Promise<void> | undefined;
  private side: DocumentSide = 'front';
  constructor(
    private readonly create: (configuration: Configuration) => Promise<CaptureSession>,
    private readonly configuration: Configuration,
    private readonly changed: (state: DocumentFlowState) => void,
    saved?: SavedDocumentCapture,
  ) {
    if (saved) {
      this.current = saved.session;
      this.state = {
        ...initial(),
        session: saved.session,
        phase: isCompleteDocument(saved.document) ? 'result' : 'frontReview',
        completed: isCompleteDocument(saved.document) ? saved.document : undefined,
        draft: isCompleteDocument(saved.document) ? undefined : saved.document,
      };
      this.listen(saved.session);
    }
  }
  private update(patch: Partial<DocumentFlowState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  private listen(session: CaptureSession) {
    this.off = session.subscribe(
      (event) => {
        if (!this.closed && this.current === session && !this.state.sheet) this.event(event);
      },
      (failure) => {
        if (!this.closed && this.current === session) this.fail(failure);
      },
    );
  }
  private async session(epoch: number) {
    if (this.current) return this.current;
    const session = await this.acquisition.open(
      () => this.create(this.configuration),
      () => !this.closed && epoch === this.epoch,
      (created) => {
        this.current = created;
        this.listen(created);
        this.update({ session: created });
      },
    );
    if (!session) throw new CaptureFlowError('cancelled');
    return session;
  }
  private async run(
    phase: Phase,
    recovery: Recovery,
    work: (session: CaptureSession, epoch: number) => Promise<void>,
  ) {
    if (this.closed || this.state.busy || this.state.capturing) return;
    const epoch = ++this.epoch;
    this.update({ phase, busy: true, sheet: undefined, issue: undefined });
    let pending: Promise<void> | undefined;
    try {
      const session = await this.session(epoch);
      if (this.closed || epoch !== this.epoch) return;
      pending = work(session, epoch);
      this.activeWork = pending;
      await pending;
    } catch (error) {
      if (!this.closed && epoch === this.epoch) {
        this.update({ capturing: false, ready: false, sheet: this.failure(error, recovery) });
      }
    } finally {
      if (this.activeWork === pending) this.activeWork = undefined;
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
  restoreSelected = () =>
    this.run('loading', 'load', async (session, epoch) => {
      const observation = await session.restoreDocumentSelection();
      if (observation && !this.closed && epoch === this.epoch) this.accept(observation);
    });
  open = () => {
    if (this.current) return Promise.resolve();
    return this.run('loading', 'load', async (session, epoch) => {
      const records = await session.listDocuments();
      if (this.closed || epoch !== this.epoch) return;
      const saved = groupDocuments(records);
      this.update({ saved });
      const only = saved[0];
      if (saved.length === 1 && only) {
        this.update({ selected: only.captureID });
        const observation = await session.recoverDocument(only.captureID);
        if (!this.closed && epoch === this.epoch) this.accept(observation);
      } else this.update({ phase: saved.length ? 'saved' : 'intro' });
    });
  };
  recoverSaved = (captureID: string) =>
    this.run('loading', 'recover', async (session, epoch) => {
      this.update({ selected: captureID });
      const observation = await session.recoverDocument(captureID);
      if (!this.closed && epoch === this.epoch) this.accept(observation);
    });
  startFront = () => this.start('front');
  startBack = () => this.start('back');
  private start(side: DocumentSide) {
    if (this.closed || this.state.busy || this.state.capturing) return Promise.resolve();
    if (side === 'back' && !this.state.draft?.front) return Promise.resolve();
    this.side = side;
    if (side === 'front') this.update({ draft: undefined });
    this.update({ ready: false });
    return this.run(side, side, async (session) => {
      await session.startDocument({ consent: true, side });
    });
  }
  capture = () => {
    if (!this.state.ready) return Promise.resolve();
    return this.run(this.side, this.side, async (session) => {
      this.update({ capturing: true, ready: false });
      await session.captureDocument();
    });
  };
  private accept(observation: DocumentObservation, reveal = true) {
    if (isCompleteDocument(observation)) {
      this.update({
        completed: observation,
        draft: undefined,
        capturing: false,
        ready: false,
        ...(reveal ? { phase: 'result' as const } : {}),
      });
    } else if (observation.front) {
      this.update({
        draft: observation,
        capturing: false,
        ready: false,
        ...(reveal ? { phase: 'frontReview' as const } : {}),
      });
    }
  }
  /** Presents a rejected settlement in this screen's sheet. */
  fail = (error: unknown) => this.update({ busy: false, sheet: this.failure(error, 'snapshot') });
  private failure(error: unknown, fallback: Recovery): Sheet {
    const code = errorCode(error);
    if (code === 'cameraPermissionDenied')
      return {
        title: t('license.sheet.allowCameraTitle'),
        message: t('license.sheet.allowCameraBody'),
        recovery: 'settings',
      };
    if (code === 'cameraPermissionRestricted')
      return {
        title: t('license.sheet.restrictedTitle'),
        message: t('license.sheet.restrictedBody'),
        recovery: 'details',
      };
    if (code !== undefined && cameraUnavailable[code])
      return {
        title: t('license.sheet.cameraUnavailableTitle'),
        message: cameraUnavailable[code],
        recovery: 'details',
      };
    if (
      code === 'invalidConfiguration' ||
      code === 'documentNotConfigured' ||
      code === 'cameraConfigurationFailed'
    )
      return {
        title: t('license.sheet.notAvailableTitle'),
        message: t('license.sheet.notAvailableBody'),
        recovery: 'details',
      };
    if (code === 'documentSidesMismatch')
      return {
        title: t('license.sheet.mismatchTitle'),
        message: t('license.sheet.mismatchBody'),
        recovery: 'back',
      };
    if (['load', 'recover', 'snapshot'].includes(fallback) || (code !== undefined && storageCodes.has(code)))
      return {
        title: t('license.sheet.savedTitle'),
        message: t('license.sheet.savedBody'),
        recovery: fallback,
      };
    return {
      title: t('common.letsTryAgain'),
      message:
        code === 'cancelled'
          ? t('license.sheet.paused')
          : errorText(code, captureErrors, t('license.captureError.other')),
      recovery: fallback,
    };
  }
  private async settle(reveal: boolean) {
    const session = this.current;
    const [, , acquired] = await Promise.allSettled([
      session?.cancel(),
      this.activeWork,
      this.acquisition.drain(),
    ]);
    if (acquired.status === 'rejected') throw acquired.reason;
    if (!session || this.closed || this.current !== session) return;
    // A native capture can commit before its event crosses the bridge. Read back the settled
    // snapshot before showing retained results so images and observations remain paired.
    try {
      const observation = await session.documentResult();
      if (!this.closed && this.current === session) this.accept(observation, reveal);
    } catch (error) {
      if (errorCode(error) !== 'documentUnavailable') throw error;
    }
  }
  pause = async () => {
    if (this.closed || this.state.sheet || !['front', 'back', 'loading'].includes(this.state.phase)) return;
    const epoch = ++this.epoch;
    const recovery: Recovery = this.state.phase === 'loading' ? 'load' : this.side;
    this.update({
      busy: true,
      ready: false,
      capturing: false,
      sheet: { title: t('license.sheet.pausedTitle'), message: t('license.sheet.pausedBody'), recovery },
    });
    try {
      await this.settle(false);
    } catch (error) {
      if (epoch === this.epoch) this.update({ sheet: this.failure(error, 'snapshot') });
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  };
  retry = () => {
    if (this.state.busy) return Promise.resolve();
    const recovery = this.state.sheet?.recovery;
    this.update({ sheet: undefined });
    if (recovery === 'load') return this.reload();
    if (recovery === 'recover' && this.state.selected) return this.recoverSaved(this.state.selected);
    if (recovery === 'details' || recovery === 'snapshot') return this.backToDetails();
    return (recovery === 'back' || (recovery === 'settings' && this.side === 'back')) &&
      this.state.draft?.front
      ? this.startBack()
      : this.startFront();
  };
  private reload = () =>
    this.run('loading', 'load', async (session, epoch) => {
      const choices = groupDocuments(await session.listDocuments());
      if (epoch !== this.epoch || this.closed) return;
      this.update({ saved: choices });
      const only = choices[0];
      if (choices.length === 1 && only) {
        this.update({ selected: only.captureID });
        const observation = await session.recoverDocument(only.captureID);
        if (epoch === this.epoch && !this.closed) this.accept(observation);
      } else this.update({ phase: choices.length ? 'saved' : 'intro' });
    });
  backToDetails = async () => {
    if (this.closed || this.state.busy) return;
    const epoch = ++this.epoch;
    this.update({ busy: true, capturing: false, ready: false });
    try {
      await this.settle(false);
      if (epoch === this.epoch && !this.closed)
        this.update({
          sheet: undefined,
          phase: this.state.completed ? 'result' : this.state.draft?.front ? 'frontReview' : 'intro',
        });
    } catch (error) {
      if (epoch === this.epoch) this.update({ sheet: this.failure(error, 'snapshot') });
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  };
  handoff = async (): Promise<SavedDocumentCapture | undefined> => {
    if (this.closed) return undefined;
    ++this.epoch;
    this.update({ busy: true, ready: false, capturing: false });
    try {
      await this.settle(false);
    } catch (error) {
      this.update({ busy: false, sheet: this.failure(error, 'snapshot') });
      throw error;
    }
    const document = this.state.completed ?? this.state.draft;
    if (!this.current || !document?.front) {
      await this.dispose();
      return undefined;
    }
    const result = { session: this.current, document };
    this.closed = true;
    this.off?.();
    this.off = undefined;
    this.current = undefined;
    return result;
  };
  dispose = (): Promise<void> => {
    if (this.disposal !== undefined) return this.disposal;
    this.closed = true;
    ++this.epoch;
    this.off?.();
    this.off = undefined;
    const session = this.current;
    this.current = undefined;
    this.disposal = Promise.allSettled([session?.release(), this.activeWork, this.acquisition.drain()]).then(
      ([released, , acquired]) => {
        if (released.status === 'rejected') throw released.reason;
        if (acquired.status === 'rejected') throw acquired.reason;
      },
    );
    return this.disposal;
  };
  private event(event: CaptureEvent) {
    if (event.type === 'previewChanged' && event.kind === 'document')
      this.update({ preview: this.state.preview + 1 });
    else if (event.type === 'documentProgress' && ['front', 'back'].includes(this.state.phase)) {
      this.update({ ready: event.ready, issue: event.issue });
    } else if (event.type === 'documentCaptured' && ['front', 'back'].includes(this.state.phase)) {
      this.accept(event.observation);
    } else if (event.type === 'failure' && event.capability === 'document') {
      const sheet = this.failure({ code: event.code }, this.side);
      this.failCamera(sheet).catch(this.fail);
    }
  }
  private async failCamera(sheet: Sheet) {
    const epoch = ++this.epoch;
    this.update({ busy: true, ready: false, capturing: false, sheet });
    try {
      await this.settle(false);
    } catch (error) {
      if (epoch === this.epoch) this.update({ sheet: this.failure(error, 'snapshot') });
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
}

/** Capture UUID order is not time order. One explicit choice represents each workflow. */
export function groupDocuments(records: DocumentRecordSummary[]): SavedDocumentChoice[] {
  const choices = new Map<string, SavedDocumentChoice>();
  for (const record of records) {
    const existing = choices.get(record.workflowID);
    if (!existing || record.side === 'back')
      choices.set(record.workflowID, {
        workflowID: record.workflowID,
        captureID: record.captureID,
        hasBack: record.side === 'back' || existing?.hasBack === true,
      });
  }
  return [...choices.values()];
}
