import type { SubscriberComparisonResult } from '@kenshiki/identity-capture';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { property, required } from '../testing/support';
import { t } from '../locales/i18n';
import { SubscriberResultDetails } from './SubscriberResultDetails';
import { ListSection, ValueRow } from '../ui/List';

jest.mock('@kenshiki/identity-capture', () => ({ IdentitySymbol: 'MockSymbol' }));

function fixture(): SubscriberComparisonResult {
  return {
    operationID: 'synthetic-comparison',
    profileVersion: 'synthetic',
    subjectRevision: 'synthetic',
    numberVerificationReference: 'challenge',
    completedAt: '2026-10-11T12:00:00Z',
    provider: {
      providerID: 'Synthetic provider',
      product: 'Synthetic comparison',
      apiVersion: 'v1',
      adapterVersion: 'v1',
      reviewRevision: 'not-live',
    },
    checks: [
      {
        name: 'givenName',
        submitted: true,
        compared: true,
        outcome: 'noMatch',
        scope: 'individualAttribute',
        coveredInputs: ['givenName'],
        reason: 'reportedGrade',
      },
      {
        name: 'birthDate',
        submitted: true,
        compared: null,
        outcome: 'noData',
        scope: 'unqualified',
        coveredInputs: [],
        reason: 'noData',
      },
    ],
    evaluation: {
      status: 'incomplete',
      policyVersion: 'test-only',
      requiredChecks: ['givenName', 'birthDate'],
      gradePolicy: {
        givenName: ['exactMatch'],
        familyName: ['exactMatch'],
        birthDate: ['exactMatch'],
        addressLines: ['exactMatch'],
        city: ['exactMatch'],
        region: ['exactMatch'],
        postalCode: ['exactMatch'],
        country: ['exactMatch'],
      },
      outsidePolicyChecks: ['givenName'],
      incompleteChecks: ['birthDate'],
      sourceFreshness: 'unknownTimeAllowed',
    },
    source: { kind: 'unknown' },
    wholeAddress: {
      submitted: true,
      compared: true,
      outcome: 'exactMatch',
      coveredInputs: [],
      reason: 'reportedGrade',
      coverageBasis: 'unverified',
    },
  };
}
let view: ReactTestRenderer;
afterEach(async () => {
  await act(async () => view?.unmount());
});
async function render(result?: SubscriberComparisonResult) {
  await act(async () => {
    view = create(<SubscriberResultDetails result={result} />);
  });
}
const words = () => JSON.stringify(view.toJSON());
function section(header: string) {
  return required(view.root.findAllByType(ListSection).find((node) => property(node, 'header') === header));
}
function value(container: ReactTestInstance, label: string) {
  return property(
    required(container.findAllByType(ValueRow).find((node) => property(node, 'label') === label)),
    'value',
  );
}

test('Evaluation precedes field evidence, whole-address limits and source provenance', async () => {
  await render(fixture());
  const sections = view.root.findAllByType(ListSection);
  expect(sections.map((node) => property(node, 'header'))).toEqual([
    t('phone.result.comparisonTitle'),
    t('subscriber.label.givenName'),
    t('subscriber.label.birthDate'),
    t('subscriber.wholeAddressTitle'),
    undefined,
  ]);
  expect(value(required(sections[0]), t('common.reportedOutcome'))).toBe(t('subscriber.status.incomplete'));
  expect(value(required(sections[0]), t('subscriber.outsidePolicy'))).toBe(t('subscriber.label.givenName'));
  expect(value(required(sections[0]), t('subscriber.incompleteDetails'))).toBe(
    t('subscriber.label.birthDate'),
  );
  expect(value(section(t('subscriber.label.givenName')), t('subscriber.result'))).toBe(
    t('subscriber.label.noMatch'),
  );
  expect(value(section(t('subscriber.label.birthDate')), t('subscriber.result'))).toBe(
    t('subscriber.label.noData'),
  );
  expect(value(required(sections.at(-1)), t('subscriber.recordSource'))).toBe(t('subscriber.label.unknown'));
  expect(value(required(sections.at(-1)), t('subscriber.sourceObserved'))).toBe(t('common.notReturned'));
});

test('Whole-address exact match does not fill missing individual fields or change evaluation', async () => {
  await render(fixture());
  const whole = section(t('subscriber.wholeAddressTitle'));
  expect(value(whole, t('subscriber.result'))).toBe(t('subscriber.label.exactMatch'));
  expect(value(whole, t('subscriber.coverageBasis'))).toBe(t('subscriber.label.unverified'));
  expect(value(whole, t('subscriber.fieldsCovered'))).toBe(t('common.noneReported'));
  expect(words()).toContain(t('subscriber.wholeAddressNotice'));
  expect(words()).toContain(t('subscriber.status.incomplete'));
  expect(words()).not.toContain(t('subscriber.status.satisfied'));
});

test('False submitted and compared remain No while missing comparison remains Not returned', async () => {
  const result = fixture();
  result.checks[0] = {
    ...required(result.checks[0]),
    submitted: false,
    compared: false,
    outcome: 'notRequested',
    scope: 'notApplicable',
    coveredInputs: [],
    reason: 'notRequested',
  };
  await render(result);
  const first = section(t('subscriber.label.givenName'));
  expect(value(first, t('subscriber.submitted'))).toBe(t('common.no'));
  expect(value(first, t('subscriber.comparedByCarrier'))).toBe(t('common.no'));
  expect(value(first, t('subscriber.scope'))).toBe(t('subscriber.label.notApplicable'));
  const second = section(t('subscriber.label.birthDate'));
  expect(value(second, t('subscriber.submitted'))).toBe(t('common.yes'));
  expect(value(second, t('subscriber.comparedByCarrier'))).toBe(t('common.notReturned'));
});

test.each(['satisfied', 'notSatisfied'] as const)(
  'Reported policy %s stays separate from a partial field grade',
  async (status) => {
    const result = fixture();
    result.checks[0] = { ...required(result.checks[0]), outcome: 'partialMatch' };
    result.evaluation = { ...result.evaluation, status };
    await render(result);
    expect(value(section(t('phone.result.comparisonTitle')), t('common.reportedOutcome'))).toBe(
      t(`subscriber.status.${status}`),
    );
    expect(value(section(t('subscriber.label.givenName')), t('subscriber.result'))).toBe(
      t('subscriber.label.partialMatch'),
    );
  },
);

test('Absent results distinguish no reply, undispatched comparison and unknown outcome', async () => {
  await render();
  expect(words()).toContain(t('subscriber.noResult'));
  expect(view.root.findAllByType(ValueRow)).toHaveLength(0);
  for (const failure of ['capabilityUnavailable', 'outcomeUnknown'] as const) {
    await act(async () => {
      view.update(<SubscriberResultDetails failure={failure} />);
    });
    expect(words()).toContain(t(`subscriber.failure.${failure}`));
    expect(words()).not.toContain(t('subscriber.status.satisfied'));
    expect(view.root.findAllByType(ValueRow)).toHaveLength(0);
  }
});
