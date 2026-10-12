import {
  type Configuration,
  type FaceComparison,
  IdentityCaptureImage,
  IdentityCaptureSession,
  type PassportObservation,
} from '@kenshiki/identity-capture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { invoke, mockSession, property, required } from '../testing/support';
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
    view = create(<CaptureResultDetails result={result} focus="passport" />);
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

test('Passport separates identity, integrity and chip access while excluding Face-only evidence', async () => {
  const result = fixture();
  await render(result);
  const sections = view.root.findAllByType(ListSection);
  const identity = sectionContaining(t('passport.field.personalNumber'));
  const integrity = sectionContaining(t('passport.protocol.countrySigningChain'));
  const access = sectionContaining(t('passport.protocol.basicAccessControl'));
  expect(identity).not.toBe(integrity);
  expect(integrity).not.toBe(access);
  expect(sections.indexOf(identity)).toBeLessThan(sections.indexOf(integrity));
  expect(sections.indexOf(integrity)).toBeLessThan(sections.indexOf(access));
  expect(words()).toContain('PERSONAL-DETAIL');
  for (const absent of [
    'face-only-route',
    'face-only-depth-policy',
    'face-only-selfie',
    t('face.title'),
    t('face.technical.similarity'),
  ])
    expect(words()).not.toContain(absent);
  expect(view.root.findAllByProps({ testID: 'face-result' })).toHaveLength(0);
  const images = view.root.findAllByType(IdentityCaptureImage);
  expect(images).toHaveLength(1);
  expect(property(required(images[0]), 'image')).toBe('reference');
  expect(property(required(images[0]), 'session')).toBe(result.session);
  expect(property(required(images[0]), 'sha256')).toBe(result.passport.portraitSHA256);
  for (const method of ['readPassport', 'compareFace', 'startMRZ', 'release'] as const)
    expect(result.session[method]).not.toHaveBeenCalled();
});

test('Passport keeps integrity failures and unperformed checks distinct from successful BAC fallback', async () => {
  await render(fixture());
  expect(words()).toContain(t('passport.protocolFailed.documentSignature'));
  expect(words()).toContain(t('passport.protocolStatus.notPerformed'));
  expect(words()).toContain(t('passport.protocolStatus.bacFallback'));
  expect(words()).not.toContain(t('passport.protocolFailed.pace'));
  expect(words()).toContain(t('passport.result.differs'));
  expect(words()).toContain(t('passport.result.notCompared'));
  expect(words()).toContain(t('passport.result.chipChecksRecorded'));
});

test('Passport only hides optional unperformed protocols when the declared groups establish absence', async () => {
  const result = fixture();
  await render(result);
  expect(words()).toContain(t('passport.protocol.activeAuthentication'));
  expect(words()).toContain(t('passport.protocol.chipAuthentication'));
  await act(async () => {
    view.update(
      <CaptureResultDetails
        result={{ ...result, passport: { ...result.passport, declaredDataGroups: ['DG1', 'DG2'] } }}
        focus="passport"
      />,
    );
  });
  expect(words()).not.toContain(t('passport.protocol.activeAuthentication'));
  expect(words()).not.toContain(t('passport.protocol.chipAuthentication'));
  await act(async () => {
    view.update(
      <CaptureResultDetails
        result={{
          ...result,
          passport: {
            ...result.passport,
            declaredDataGroups: ['DG1', 'DG2'],
            protocols: { ...result.passport.protocols, activeAuthentication: 'failed' },
          },
        }}
        focus="passport"
      />,
    );
  });
  expect(words()).toContain(t('passport.protocol.activeAuthentication'));
  expect(words()).toContain(t('passport.protocolFailed.activeAuthentication'));
});

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
      focus="passport"
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

test('Passport actions prioritize chip reread, preserve explicit routes and clear confirmation intent', async () => {
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
    t('passport.action.readChipAgain'),
    t('passport.action.retakeSelfie'),
    t('hub.action.clearResults'),
  ]);
  expect(start).not.toHaveBeenCalled();
  expect(requestClear).not.toHaveBeenCalled();
  for (const action of actions) {
    expect(property(action, 'grouped')).toBe(true);
    await act(async () => {
      invoke(action, 'onPress');
    });
  }
  expect(start.mock.calls).toEqual([['read'], ['selfie']]);
  expect(requestClear.mock.calls).toEqual([['passport']]);
  expect(result.session.eraseResults).not.toHaveBeenCalled();
  expect(IdentityCaptureSession.create).not.toHaveBeenCalled();
});

test('Passport configuration and portrait guards remain specific to the requested action', async () => {
  await act(async () => {
    view = create(<ResultHarness configuration={{}} />);
  });
  expect(property(view.root.findByType(Action), 'disabled')).toBe(true);
  await act(async () => {
    view.update(<ResultHarness configuration={{ trustAnchorsURL: 'file:///anchors' }} />);
  });
  expect(property(view.root.findByType(Action), 'disabled')).toBe(false);
  await act(async () => {
    invoke(view.root.findByType(Action), 'onPress');
  });
  expect(start.mock.calls).toEqual([[]]);
  const result = fixture();
  await act(async () => {
    view.update(<ResultHarness result={result} configuration={{}} />);
  });
  let actions = view.root.findAllByType(Action);
  expect(property(required(actions[0]), 'disabled')).toBe(true);
  expect(property(required(actions[1]), 'disabled')).toBe(true);
  await act(async () => {
    view.update(
      <ResultHarness
        result={{ ...result, passport: { ...result.passport, portraitAvailable: false } }}
        configuration={{
          trustAnchorsURL: 'file:///anchors',
          embedderURL: 'file:///embedder',
          detectorURL: 'file:///detector',
        }}
      />,
    );
  });
  actions = view.root.findAllByType(Action);
  expect(property(required(actions[0]), 'disabled')).toBe(false);
  expect(property(required(actions[1]), 'disabled')).toBe(true);
  expect(start.mock.calls).toEqual([[]]);
});
