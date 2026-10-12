import {
  type Configuration,
  type FaceComparison,
  IdentityCaptureImage,
  IdentityCaptureSession,
  type PassportObservation,
} from '@kenshiki/identity-capture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, mockSession, property, required, without } from '../testing/support';
import type { CompletedCapture } from './CaptureFlowController';
import { CaptureResultDetails } from './IdentityCaptureFlow';
import { PassportResult } from './IdentityResults';
import { t } from '../locales/i18n';
import { Action } from '../ui/Action';
import { createControllerCustody } from '../ui/ControllerCustody';
import { ListSection } from '../ui/List';
import { useIdentityWorkspace } from '../app/useIdentityWorkspace';

jest.mock('@kenshiki/identity-capture', () => ({
  IdentityCaptureImage: 'PassportImage',
  IdentityCaptureSession: { create: jest.fn() },
}));

function fixture(): CompletedCapture {
  const passport: PassportObservation = {
    documentNumber: 'PASSPORT-ONLY',
    birthDateYYMMDD: '990203',
    expiryDateYYMMDD: '310405',
    surname: 'EXAMPLE',
    givenNames: 'PASSPORT',
    nationality: 'UTO',
    issuingState: 'UTO',
    sex: 'F',
    portraitAvailable: true,
    portraitSHA256: 'passport-bound-photo',
    personalNumber: 'PERSONAL-DETAIL',
    dateOfIssue: null,
    issuingAuthority: null,
    placeOfBirth: null,
    correspondence: { documentNumber: 'differs', birthDate: 'notCompared' },
    protocolVerdicts: { source: 'recorded', recordedAt: '2026-10-11T12:00:00Z' },
    protocols: {
      countrySigningChain: 'succeeded',
      documentSignature: 'failed',
      dataGroupHashes: 'notPerformed',
      activeAuthentication: 'notPerformed',
      chipAuthentication: 'notPerformed',
      basicAccessControl: 'succeeded',
      pace: 'failed',
    },
  };
  const comparison: FaceComparison = {
    outcome: 'manual_review',
    similarity: 0.321,
    implementationVersion: 'face-only-model',
    referenceSHA256: 'comparison-bound-photo',
    selfieSHA256: 'face-only-selfie',
    route: 'face-only-route',
    modelLoadingSeconds: 4,
    comparisonSeconds: 5,
    admissionReceipt: {
      policyVersion: 'face-policy',
      frameTimestamp: 2,
      anchorID: 'face-anchor',
      blinkCompletedAt: 2,
      leftEyeClosed: 0,
      rightEyeClosed: 0,
      captureQualityEnforced: false,
      guideContainmentEnforced: false,
      trigger: 'automatic',
      eyesOpen: true,
      blinkAge: 0.1,
      consecutiveTrackedFrames: 12,
      steadyHoldDuration: 2,
      depthEvidence: {
        schemaVersion: 1,
        imageTimestamp: 2,
        depthTimestamp: 2,
        orientation: 1,
        mapWidth: 16,
        mapHeight: 16,
        imageSHA256: 'face-only-selfie',
        filtered: false,
        ageAtAdmission: 0.1,
        measurement: {
          sampleCount: 128,
          residualRMS: 0.02,
          policy: {
            identifier: 'face-only-depth-policy',
            minimumResidualRMS: 0.003,
            minimumSamples: 32,
            maximumDepthAge: 0.3,
            nearLimit: 0.2,
            farLimit: 1.3,
            samplesPerAxis: 8,
          },
        },
      },
    },
  };
  return { session: mockSession({}), passport, comparison };
}
let view: ReactTestRenderer;
afterEach(async () => {
  await act(async () => view?.unmount());
});
async function render(result: CompletedCapture) {
  await act(async () => {
    view = create(<CaptureResultDetails result={result} focus="face" />);
  });
}
const words = () => JSON.stringify(view.toJSON());
function sectionContaining(text: string) {
  return required(
    view.root
      .findAllByType(ListSection)
      .find((section) =>
        JSON.stringify(
          section
            .findAll((node) => typeof property(node, 'label') === 'string')
            .map((node) => property(node, 'label')),
        ).includes(text),
      ),
  );
}

const noConfiguration: Configuration = {};
const start = jest.fn();
const requestClear = jest.fn();
const home = jest.fn();
const navigate = jest.fn();
function ResultHarness({
  result,
  configuration,
}: {
  result?: CompletedCapture;
  configuration: Configuration;
}) {
  const workspace = useIdentityWorkspace(noConfiguration, home, navigate, custody);
  return (
    <PassportResult
      focus="face"
      configuration={configuration}
      workspace={{
        ...workspace,
        passport: { ...workspace.passport, result, start },
        recovery: { ...workspace.recovery, requestClear },
      }}
    />
  );
}
let custody = createControllerCustody();
beforeEach(() => {
  jest.clearAllMocks();
  custody = createControllerCustody();
});

test('Face binds the compared photo pair and excludes passport identity and access details', async () => {
  const result = fixture();
  await render(result);
  const images = view.root.findAllByType(IdentityCaptureImage);
  expect(images).toHaveLength(2);
  expect(images.map((node) => property(node, 'sha256'))).toEqual([
    required(result.comparison).referenceSHA256,
    required(result.comparison).selfieSHA256,
  ]);
  expect(images.map((node) => property(node, 'image'))).toEqual(['reference', 'selfie']);
  for (const image of images) expect(property(image, 'session')).toBe(result.session);
  for (const absent of [
    'PASSPORT-ONLY',
    'PERSONAL-DETAIL',
    t('passport.field.documentNumber'),
    t('passport.protocol.basicAccessControl'),
    t('passport.result.correspondenceHeading'),
  ])
    expect(words()).not.toContain(absent);
  expect(words()).toContain(t('face.outcome.manualReview'));
  expect(words()).toContain('0.321');
  expect(words()).not.toContain('32.1%');
  const sections = view.root.findAllByType(ListSection);
  const evidence = sectionContaining(t('face.eyesOpen'));
  const diagnostics = sectionContaining(t('face.technical.referenceDigest'));
  expect(sections.indexOf(evidence)).toBeLessThan(sections.indexOf(diagnostics));
  for (const method of ['readPassport', 'compareFace', 'startMRZ', 'release', 'eraseResults'] as const)
    expect(result.session[method]).not.toHaveBeenCalled();
});

test.each([
  ['pass', 'face.outcome.pass'],
  ['fail', 'face.outcome.fail'],
  ['manual_review', 'face.outcome.manualReview'],
] as const)(
  'Face preserves the %s outcome without converting similarity into a verdict',
  async (outcome, label) => {
    const result = fixture();
    await render({ ...result, comparison: { ...required(result.comparison), outcome, similarity: 0 } });
    expect(words()).toContain(t(label));
    for (const other of ['face.outcome.pass', 'face.outcome.fail', 'face.outcome.manualReview'] as const)
      if (other !== label) expect(words()).not.toContain(t(other));
  },
);

test('Missing depth suppresses the comparison verdict without changing the bound photos', async () => {
  const result = fixture();
  const comparison = required(result.comparison);
  await render({
    ...result,
    comparison: { ...comparison, admissionReceipt: without(comparison.admissionReceipt, 'depthEvidence') },
  });
  expect(words()).toContain(t('face.noDepth'));
  expect(words()).not.toContain(t('face.outcome.manualReview'));
  expect(words()).not.toContain(t('face.depthMeasured'));
  expect(view.root.findAllByType(IdentityCaptureImage).map((node) => property(node, 'sha256'))).toEqual([
    comparison.referenceSHA256,
    comparison.selfieSHA256,
  ]);
});

test('Without a comparison Face shows only the passport reference and no fabricated result', async () => {
  const result = fixture();
  await render(without(result, 'comparison'));
  expect(words()).toContain(t('face.notTaken'));
  expect(words()).not.toContain(t('face.outcome.manualReview'));
  const images = view.root.findAllByType(IdentityCaptureImage);
  expect(images).toHaveLength(1);
  expect(property(required(images[0]), 'sha256')).toBe(result.passport.portraitSHA256);
});

test('Eyes-open false remains an explicit No and never implies blink completion', async () => {
  const result = fixture();
  const comparison = required(result.comparison);
  await render({
    ...result,
    comparison: { ...comparison, admissionReceipt: { ...comparison.admissionReceipt, eyesOpen: false } },
  });
  const row = required(
    view.root
      .findAll((node) => property(node, 'label') === t('face.eyesOpen'))
      .find((node) => typeof property(node, 'value') === 'string'),
  );
  expect(property(row, 'value')).toBe(t('common.no'));
  expect(words()).not.toContain('Blink completed; eyes reopened');
});

test('Face groups explicit selfie, reread and confirmation actions in that order', async () => {
  const result = fixture();
  await act(async () => {
    view = create(
      <ResultHarness
        result={result}
        configuration={{
          trustAnchorsURL: 'file:///anchors',
          embedderURL: 'file:///embedder',
          detectorURL: 'file:///detector',
        }}
      />,
    );
  });
  const actions = view.root.findAllByType(Action);
  expect(actions.map((node) => property(node, 'label'))).toEqual([
    t('passport.action.retakeSelfie'),
    t('passport.action.readChipAgain'),
    t('hub.action.clearResults'),
  ]);
  expect(start).not.toHaveBeenCalled();
  expect(requestClear).not.toHaveBeenCalled();
  expect(IdentityCaptureSession.create).not.toHaveBeenCalled();
  for (const action of actions) {
    expect(property(action, 'grouped')).toBe(true);
    await act(async () => {
      invoke(action, 'onPress');
    });
  }
  expect(start.mock.calls).toEqual([['selfie'], ['read']]);
  expect(requestClear.mock.calls).toEqual([['passport']]);
  expect(result.session.eraseResults).not.toHaveBeenCalled();
});

test('Face keeps model, reference portrait and chip configuration guards independent', async () => {
  const result = fixture();
  await act(async () => {
    view = create(<ResultHarness result={result} configuration={{ trustAnchorsURL: 'file:///anchors' }} />);
  });
  let actions = view.root.findAllByType(Action);
  expect(property(required(actions[0]), 'disabled')).toBe(true);
  expect(property(required(actions[1]), 'disabled')).toBe(false);
  await act(async () => {
    view.update(
      <ResultHarness
        result={result}
        configuration={{ embedderURL: 'file:///embedder', detectorURL: 'file:///detector' }}
      />,
    );
  });
  actions = view.root.findAllByType(Action);
  expect(property(required(actions[0]), 'disabled')).toBe(false);
  expect(property(required(actions[1]), 'disabled')).toBe(true);
  await act(async () => {
    view.update(
      <ResultHarness
        result={{ ...result, passport: { ...result.passport, portraitAvailable: false } }}
        configuration={{ embedderURL: 'file:///embedder', detectorURL: 'file:///detector' }}
      />,
    );
  });
  expect(property(required(view.root.findAllByType(Action)[0]), 'disabled')).toBe(true);
  expect(start).not.toHaveBeenCalled();
});
