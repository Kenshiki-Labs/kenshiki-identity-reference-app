// Responsibility: Coordinates phone check presentation, interruption, recovery and live session handoff.
// Control: Suppresses stale completions and drains owned work before releasing or transferring the session.
// Native counterpart: PhoneCaptureRuntime and PhonePossessionSession own challenges, polling and receipt custody.
// Specification: RFC-0002 §§4.2, 13.1; capability-evidence-and-assurance-plan §3.6.

import type {
  CaptureErrorCode,
  CaptureSession,
  Configuration,
  PhoneCheckSnapshot,
} from '@kenshiki/identity-capture';
import { type ErrorText, errorCode, errorText } from './HolderText';
import { t } from './locales/i18n';
import { SessionAcquisition } from './SessionAcquisition';

export type SavedPhoneCheck = { session: CaptureSession; snapshot: PhoneCheckSnapshot };
export type PhoneFlowState = {
  snapshot?: PhoneCheckSnapshot | undefined;
  busy: boolean;
  paused: boolean;
  sheet?: ({ kind: 'restart' | 'erase' } | { kind: 'error'; message: string }) | undefined;
};

// Wording follows the SDK's native phone copy (Hosts/SensorHost/Sources/PhoneCheckCopy.swift).
const setupErrors: ErrorText = {
  compositionUnavailable: t('phone.setupError.compositionUnavailable'),
  phoneNotConfigured: t('phone.setupError.phoneNotConfigured'),
  notConfigured: t('phone.setupError.notConfigured'),
  invalidConfiguration: t('phone.setupError.invalidConfiguration'),
  unauthorized: t('phone.setupError.unauthorized'),
  contextChanged: t('phone.setupError.contextChanged'),
  recoveryRequired: t('phone.setupError.recoveryRequired'),
  messageNotSent: t('phone.setupError.messageNotSent'),
};
const checkErrors: ErrorText = {
  expired: t('phone.checkError.expired'),
  receiptUnavailable: t('phone.checkError.receiptUnavailable'),
  unknownChallenge: t('phone.checkError.unknownChallenge'),
  conflict: t('phone.checkError.conflict'),
  refused: t('phone.checkError.refused'),
  invalidResponse: t('phone.checkError.invalidResponse'),
  rateLimited: t('phone.checkError.rateLimited'),
  timedOut: t('phone.checkError.timedOut'),
  storageUnavailable: t('phone.checkError.storageUnavailable'),
  busy: t('phone.checkError.busy'),
};

/** Native SDK owns challenge identity, polling and encrypted receipts. JS only presents them. */
export class PhoneFlowController {
  state: PhoneFlowState = { busy: false, paused: false };
  private current?: CaptureSession | undefined;
  private unsubscribe?: (() => void) | undefined;
  private active?: Promise<void> | undefined;
  private readonly acquisition = new SessionAcquisition();
  private drain?: Promise<void> | undefined;
  private disposal?: Promise<void> | undefined;
  private epoch = 0;
  private closed = false;
  private eventRevision = 0;
  constructor(
    private readonly create: (configuration: Configuration) => Promise<CaptureSession>,
    private readonly configuration: Configuration,
    private readonly changed: (state: PhoneFlowState) => void,
    saved?: SavedPhoneCheck,
  ) {
    if (saved) {
      this.state.snapshot = saved.snapshot;
      this.state.paused = saved.snapshot.pending;
      this.attach(saved.session);
    }
  }
  private update(patch: Partial<PhoneFlowState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  private attach(session: CaptureSession) {
    this.current = session;
    this.unsubscribe = session.subscribe(
      (event) => {
        if (
          !this.closed &&
          event.type === 'phoneSnapshot' &&
          this.current === session &&
          this.drain === undefined
        ) {
          ++this.eventRevision;
          this.accept(event.snapshot);
        }
      },
      (failure) => {
        if (!this.closed && this.current === session && this.drain === undefined) this.fail(failure);
      },
    );
  }
  private accept(snapshot: PhoneCheckSnapshot) {
    this.update({ snapshot, paused: snapshot.pending ? this.state.paused : false });
    // PhonePossessionFailure is a subset of the command-rejection vocabulary.
    if (snapshot.failure) this.failure(snapshot.failure);
  }
  /** Presents a rejected command or interrupted drain in this screen's sheet. */
  fail = (error: unknown) => this.failure(errorCode(error));
  private failure(code?: CaptureErrorCode) {
    const finishing = this.state.snapshot?.stage === 'finishing';
    const message =
      code !== undefined && setupErrors[code]
        ? setupErrors[code]
        : finishing
          ? t('phone.checkError.finishing')
          : errorText(code, checkErrors, t('phone.checkError.other'));
    const revoked = code === 'contextChanged' || code === 'unauthorized';
    this.update({ ...(revoked ? { snapshot: undefined } : {}), sheet: { kind: 'error', message } });
  }
  private async ensureSession(epoch: number) {
    if (!this.current) {
      await this.acquisition.open(
        () => this.create(this.configuration),
        () => !this.closed && epoch === this.epoch,
        (created) => this.attach(created),
      );
    }
  }
  private run(action: (session: CaptureSession) => Promise<PhoneCheckSnapshot>) {
    if (this.closed || this.active !== undefined || this.drain !== undefined) return Promise.resolve();
    const epoch = ++this.epoch;
    this.update({ busy: true, sheet: undefined });
    const work = (async () => {
      try {
        await this.ensureSession(epoch);
        const session = this.current;
        if (!session || this.closed || epoch !== this.epoch) return;
        const revision = this.eventRevision;
        const snapshot = await action(session);
        if (!this.closed && epoch === this.epoch && revision === this.eventRevision) this.accept(snapshot);
      } catch (error) {
        if (!this.closed && epoch === this.epoch) this.fail(error);
      } finally {
        if (!this.closed && epoch === this.epoch) this.update({ busy: false });
      }
    })();
    this.active = work;
    const settled = () => {
      if (this.active === work) this.active = undefined;
    };
    work.then(settled, (error: unknown) => {
      settled();
      this.fail(error);
    });
    return work;
  }
  open = () =>
    this.run(async (session) => {
      const snapshot = await session.phoneSnapshot();
      this.update({ paused: snapshot.pending });
      return snapshot;
    });
  send = () =>
    this.run(async (session) => {
      this.update({ paused: false });
      return session.phoneSend(true);
    });
  resume = () =>
    this.run(async (session) => {
      this.update({ paused: false });
      return session.phoneResume();
    });
  save = () => this.run((session) => session.phoneRetrySave());
  ask = (kind: 'restart' | 'erase') => {
    if (!this.state.busy && this.drain === undefined) this.update({ sheet: { kind } });
  };
  dismiss = () => this.update({ sheet: undefined });
  confirm = () => {
    const kind = this.state.sheet?.kind;
    if (kind === 'restart') return this.run((session) => session.phoneStartOver(true));
    if (kind === 'erase')
      return this.run(async (session) => {
        await session.phoneCancel();
        await session.phoneErase();
        this.update({ snapshot: undefined, paused: false });
        return session.phoneSnapshot();
      });
    return Promise.resolve();
  };
  pause = (): Promise<void> => {
    if (this.closed) return Promise.resolve();
    if (this.drain !== undefined) return this.drain;
    ++this.epoch;
    this.update({ busy: true, sheet: undefined });
    const session = this.current;
    const work = (async () => {
      const [cancelled, , acquired] = await Promise.allSettled([
        session?.phoneCancel(),
        this.active,
        this.acquisition.drain(),
      ]);
      if (cancelled.status === 'rejected') throw cancelled.reason;
      if (acquired.status === 'rejected') throw acquired.reason;
      if (session && this.current === session && !this.closed) {
        const snapshot = await session.phoneSnapshot();
        this.update({ snapshot, paused: snapshot.pending });
      }
    })();
    this.drain = work;
    // The caller presents a failed drain: the backgrounding listener through `fail`, handoff below.
    const settled = () => {
      if (this.drain === work) {
        this.drain = undefined;
        this.update({ busy: false });
      }
    };
    work.then(settled, settled);
    return work;
  };
  handoff = async (): Promise<SavedPhoneCheck | undefined> => {
    if (this.closed) return undefined;
    if (!this.state.snapshot && this.active === undefined) {
      await this.dispose();
      return undefined;
    }
    try {
      await this.pause();
    } catch (error) {
      this.fail(error);
      throw error;
    }
    if (!this.current || !this.state.snapshot) {
      await this.dispose();
      return undefined;
    }
    const result = { session: this.current, snapshot: this.state.snapshot };
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.current = undefined;
    this.closed = true;
    return result;
  };
  dispose = (): Promise<void> => {
    if (this.disposal !== undefined) return this.disposal;
    this.closed = true;
    ++this.epoch;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    const session = this.current;
    this.current = undefined;
    this.disposal = Promise.allSettled([
      session?.release(),
      this.active,
      this.drain,
      this.acquisition.drain(),
    ]).then(([released, , , acquired]) => {
      if (released.status === 'rejected') throw released.reason;
      if (acquired.status === 'rejected') throw acquired.reason;
    });
    return this.disposal;
  };
}
