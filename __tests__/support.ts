import type { CaptureSession } from '@kenshiki/identity-capture';
import { ActionSheetIOS } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { t } from '../locales/i18n';
/** Replaces the iOS action sheet: records every question asked and lets the test choose. */
export function actionSheets() {
  const asked: { title: string | undefined; options: string[]; choose: (index: number) => void }[] = [];
  const spy = jest
    .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
    .mockImplementation((options, callback) => {
      asked.push({ title: options.title ?? undefined, options: [...options.options], choose: callback });
    });
  return { asked, spy, last: () => required(asked.at(-1)) };
}
/** Lets promise chains a callback started, but did not await, run to completion. */
export async function settle() {
  for (let n = 0; n < 24; n += 1) await Promise.resolve();
}
/** Unconfigured operations fail loudly instead of simulating successful native work. */
export function mockSession<T extends Partial<CaptureSession>>(overrides: T) {
  const unexpected = (): never => {
    throw new Error(t('testSupport.unexpectedNativeOperation'));
  };
  return {
    id: 'test-session',
    subscribe: jest.fn<ReturnType<CaptureSession['subscribe']>, Parameters<CaptureSession['subscribe']>>(
      unexpected,
    ),
    sensorBoard: jest.fn<
      ReturnType<CaptureSession['sensorBoard']>,
      Parameters<CaptureSession['sensorBoard']>
    >(unexpected),
    sensorStatus: jest.fn<
      ReturnType<CaptureSession['sensorStatus']>,
      Parameters<CaptureSession['sensorStatus']>
    >(unexpected),
    captureSensors: jest.fn<
      ReturnType<CaptureSession['captureSensors']>,
      Parameters<CaptureSession['captureSensors']>
    >(unexpected),
    requestSensorPermission: jest.fn<
      ReturnType<CaptureSession['requestSensorPermission']>,
      Parameters<CaptureSession['requestSensorPermission']>
    >(unexpected),
    startMRZ: jest.fn<ReturnType<CaptureSession['startMRZ']>, Parameters<CaptureSession['startMRZ']>>(
      unexpected,
    ),
    captureMRZ: jest.fn<ReturnType<CaptureSession['captureMRZ']>, Parameters<CaptureSession['captureMRZ']>>(
      unexpected,
    ),
    parseMRZ: jest.fn<ReturnType<CaptureSession['parseMRZ']>, Parameters<CaptureSession['parseMRZ']>>(
      unexpected,
    ),
    readPassport: jest.fn<
      ReturnType<CaptureSession['readPassport']>,
      Parameters<CaptureSession['readPassport']>
    >(unexpected),
    exportPassport: jest.fn<
      ReturnType<CaptureSession['exportPassport']>,
      Parameters<CaptureSession['exportPassport']>
    >(unexpected),
    setReference: jest.fn<
      ReturnType<CaptureSession['setReference']>,
      Parameters<CaptureSession['setReference']>
    >(unexpected),
    startSelfie: jest.fn<
      ReturnType<CaptureSession['startSelfie']>,
      Parameters<CaptureSession['startSelfie']>
    >(unexpected),
    captureSelfie: jest.fn<
      ReturnType<CaptureSession['captureSelfie']>,
      Parameters<CaptureSession['captureSelfie']>
    >(unexpected),
    compareFace: jest.fn<
      ReturnType<CaptureSession['compareFace']>,
      Parameters<CaptureSession['compareFace']>
    >(unexpected),
    listResults: jest.fn<
      ReturnType<CaptureSession['listResults']>,
      Parameters<CaptureSession['listResults']>
    >(unexpected),
    recoverPassport: jest.fn<
      ReturnType<CaptureSession['recoverPassport']>,
      Parameters<CaptureSession['recoverPassport']>
    >(unexpected),
    recoverFace: jest.fn<
      ReturnType<CaptureSession['recoverFace']>,
      Parameters<CaptureSession['recoverFace']>
    >(unexpected),
    retryResultSave: jest.fn<
      ReturnType<CaptureSession['retryResultSave']>,
      Parameters<CaptureSession['retryResultSave']>
    >(unexpected),
    eraseResult: jest.fn<
      ReturnType<CaptureSession['eraseResult']>,
      Parameters<CaptureSession['eraseResult']>
    >(unexpected),
    eraseResults: jest.fn<
      ReturnType<CaptureSession['eraseResults']>,
      Parameters<CaptureSession['eraseResults']>
    >(unexpected),
    documentCheckRestore: jest.fn<
      ReturnType<CaptureSession['documentCheckRestore']>,
      Parameters<CaptureSession['documentCheckRestore']>
    >(unexpected),
    documentCheck: jest.fn<
      ReturnType<CaptureSession['documentCheck']>,
      Parameters<CaptureSession['documentCheck']>
    >(unexpected),
    documentCheckAskAgain: jest.fn<
      ReturnType<CaptureSession['documentCheckAskAgain']>,
      Parameters<CaptureSession['documentCheckAskAgain']>
    >(unexpected),
    documentCheckCorrect: jest.fn<
      ReturnType<CaptureSession['documentCheckCorrect']>,
      Parameters<CaptureSession['documentCheckCorrect']>
    >(unexpected),
    startDocument: jest.fn<
      ReturnType<CaptureSession['startDocument']>,
      Parameters<CaptureSession['startDocument']>
    >(unexpected),
    captureDocument: jest.fn<
      ReturnType<CaptureSession['captureDocument']>,
      Parameters<CaptureSession['captureDocument']>
    >(unexpected),
    documentResult: jest.fn<
      ReturnType<CaptureSession['documentResult']>,
      Parameters<CaptureSession['documentResult']>
    >(unexpected),
    recoverDocument: jest.fn<
      ReturnType<CaptureSession['recoverDocument']>,
      Parameters<CaptureSession['recoverDocument']>
    >(unexpected),
    listDocuments: jest.fn<
      ReturnType<CaptureSession['listDocuments']>,
      Parameters<CaptureSession['listDocuments']>
    >(unexpected),
    eraseDocuments: jest.fn<
      ReturnType<CaptureSession['eraseDocuments']>,
      Parameters<CaptureSession['eraseDocuments']>
    >(unexpected),
    phoneSnapshot: jest.fn<
      ReturnType<CaptureSession['phoneSnapshot']>,
      Parameters<CaptureSession['phoneSnapshot']>
    >(unexpected),
    phoneSend: jest.fn<ReturnType<CaptureSession['phoneSend']>, Parameters<CaptureSession['phoneSend']>>(
      unexpected,
    ),
    phoneResume: jest.fn<
      ReturnType<CaptureSession['phoneResume']>,
      Parameters<CaptureSession['phoneResume']>
    >(unexpected),
    phoneRetrySave: jest.fn<
      ReturnType<CaptureSession['phoneRetrySave']>,
      Parameters<CaptureSession['phoneRetrySave']>
    >(unexpected),
    phoneStartOver: jest.fn<
      ReturnType<CaptureSession['phoneStartOver']>,
      Parameters<CaptureSession['phoneStartOver']>
    >(unexpected),
    phoneCancel: jest.fn<
      ReturnType<CaptureSession['phoneCancel']>,
      Parameters<CaptureSession['phoneCancel']>
    >(unexpected),
    phoneErase: jest.fn<ReturnType<CaptureSession['phoneErase']>, Parameters<CaptureSession['phoneErase']>>(
      unexpected,
    ),
    ssnSnapshot: jest.fn<
      ReturnType<CaptureSession['ssnSnapshot']>,
      Parameters<CaptureSession['ssnSnapshot']>
    >(unexpected),
    ssnRequestConfirmation: jest.fn<
      ReturnType<CaptureSession['ssnRequestConfirmation']>,
      Parameters<CaptureSession['ssnRequestConfirmation']>
    >(unexpected),
    ssnRequestFreshConfirmation: jest.fn<
      ReturnType<CaptureSession['ssnRequestFreshConfirmation']>,
      Parameters<CaptureSession['ssnRequestFreshConfirmation']>
    >(unexpected),
    ssnConfirm: jest.fn<ReturnType<CaptureSession['ssnConfirm']>, Parameters<CaptureSession['ssnConfirm']>>(
      unexpected,
    ),
    ssnRecover: jest.fn<ReturnType<CaptureSession['ssnRecover']>, Parameters<CaptureSession['ssnRecover']>>(
      unexpected,
    ),
    ssnCancel: jest.fn<ReturnType<CaptureSession['ssnCancel']>, Parameters<CaptureSession['ssnCancel']>>(
      unexpected,
    ),
    ssnErase: jest.fn<ReturnType<CaptureSession['ssnErase']>, Parameters<CaptureSession['ssnErase']>>(
      unexpected,
    ),
    cancel: jest.fn<ReturnType<CaptureSession['cancel']>, Parameters<CaptureSession['cancel']>>(unexpected),
    release: jest.fn<ReturnType<CaptureSession['release']>, Parameters<CaptureSession['release']>>(
      unexpected,
    ),
    ...overrides,
  };
}
export function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error(t('testSupport.missingFixture'));
  return value;
}
export function property(node: ReactTestInstance, key: string): unknown {
  return node.props[key];
}
function isCallback(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}
export function invoke(node: ReactTestInstance, key: string, ...args: unknown[]): unknown {
  const callback = property(node, key);
  if (!isCallback(callback)) throw new Error(t('testSupport.missingHandler', { key }));
  return callback(...args);
}
export function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: omitted, ...rest } = value;
  void omitted;
  return rest;
}
