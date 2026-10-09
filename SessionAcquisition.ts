import type { CaptureSession } from '@kenshiki/identity-capture';

/** Creating a native session is owned work, including cleanup if its caller leaves before the
 * handle returns. A creation error owns no session; a failed release must keep custody blocked. */
export class SessionAcquisition {
  private pending?: Promise<CaptureSession | undefined>;
  private releasing?: Promise<void>;

  open(
    create: () => Promise<CaptureSession>,
    isCurrent: () => boolean,
    adopt: (session: CaptureSession) => void,
  ): Promise<CaptureSession | undefined> {
    this.pending = this.createAndAdopt(create, isCurrent, adopt);
    return this.pending;
  }

  private async createAndAdopt(
    create: () => Promise<CaptureSession>,
    isCurrent: () => boolean,
    adopt: (session: CaptureSession) => void,
  ): Promise<CaptureSession | undefined> {
    if (this.releasing !== undefined) await this.releasing;
    if (!isCurrent()) return undefined;
    const session = await create();
    if (isCurrent()) {
      adopt(session);
      return session;
    }
    this.releasing = Promise.resolve().then(() => session.release());
    await this.releasing;
    return undefined;
  }

  async drain(): Promise<void> {
    // Command recovery owns acquisition errors. Drain still waits for them, and separately
    // preserves release failure so ordinary configuration errors cannot poison the next holder.
    await Promise.allSettled([this.pending]);
    await this.releasing;
  }
}
