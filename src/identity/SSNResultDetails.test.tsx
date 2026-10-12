import type { DocumentCustodyPresentation, SSNVerificationReceipt } from '@kenshiki/identity-capture';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ssnReceipt, ssnSatisfiedReceipt } from '../testing/ssnFixture';
import { invoke, mockSession, property, required, settle } from '../testing/support';
import { t } from '../locales/i18n';
import { SSNResultDetails } from './SSNResultDetails';
import { ListSection, ValueRow } from '../ui/List';

jest.mock('@kenshiki/identity-capture', () => ({ IdentitySymbol: 'MockSymbol' }));
let view: ReactTestRenderer;
afterEach(async () => {
  await act(async () => view?.unmount());
});
async function render(receipt: SSNVerificationReceipt) {
  await act(async () => {
    view = create(<SSNResultDetails receipt={receipt} />);
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

test('Summary and limits precede five independently reported checks in contract order', async () => {
  const report = required(ssnReceipt.fiveChecks);
  await render({
    ...ssnReceipt,
    fiveChecks: {
      ...report,
      checks: {
        ...report.checks,
        ssn_name_association: { ...report.checks.ssn_name_association, outcome: 'mismatch' },
        ssn_address_association: { ...report.checks.ssn_address_association, outcome: 'unavailable' },
      },
    },
  });
  const sections = view.root.findAllByType(ListSection);
  expect(sections.map((node) => property(node, 'header'))).toEqual([
    t('ssn.summary.fiveIncomplete'),
    t('ssn.result.checksTitle'),
    t('ssn.result.diagnostics'),
  ]);
  expect(required(sections[0]).findAllByType(ValueRow)).toHaveLength(0);
  expect(words()).toContain(t('ssn.result.ownership'));
  const rows = section(t('ssn.result.checksTitle')).findAllByType(ValueRow);
  expect(rows.map((node) => property(node, 'label'))).toEqual(
    (['issuance', 'deathMasterFile', 'name', 'address', 'phone'] as const).map((key) =>
      t(`ssn.result.check.${key}`),
    ),
  );
  expect(rows.map((node) => property(node, 'value'))).toEqual([
    t('ssn.result.issued'),
    t('ssn.result.deathOutcome.indeterminate'),
    t('ssn.result.outcome.mismatch'),
    t('ssn.result.outcome.unavailable'),
    t('ssn.result.outcome.match'),
  ]);
  expect(words()).not.toContain(t('ssn.summary.fiveSatisfied'));
});

test.each(['match', 'mismatch', 'indeterminate', 'unavailable'] as const)(
  'Death-file %s is shown with death-specific meaning',
  async (outcome) => {
    const report = required(ssnReceipt.fiveChecks);
    await render({
      ...ssnReceipt,
      reportedOutcome: 'negative',
      fiveChecks: {
        ...report,
        checks: { ...report.checks, death_master_file: { ...report.checks.death_master_file, outcome } },
      },
    });
    expect(value(section(t('ssn.result.checksTitle')), t('ssn.result.check.deathMasterFile'))).toBe(
      t(`ssn.result.deathOutcome.${outcome}`),
    );
    expect(view.root.findAllByType(ListSection).map((node) => property(node, 'header'))).toContain(
      t('ssn.summary.fiveNotSatisfied'),
    );
    expect(words()).not.toContain(t('ssn.summary.fiveSatisfied'));
  },
);

test.each(['affirmative', 'negative', 'unavailable'] as const)(
  'Aggregate %s is reported independently of issuance',
  async (reportedOutcome) => {
    await render({ ...ssnSatisfiedReceipt, reportedOutcome, issuance: 'issued' });
    const expected =
      reportedOutcome === 'affirmative'
        ? 'fiveSatisfied'
        : reportedOutcome === 'negative'
          ? 'fiveNotSatisfied'
          : 'fiveIncomplete';
    expect(property(required(view.root.findAllByType(ListSection)[0]), 'header')).toBe(
      t(`ssn.summary.${expected}`),
    );
    expect(value(section(t('ssn.result.checksTitle')), t('ssn.result.check.issuance'))).toBe(
      t('ssn.result.issued'),
    );
  },
);

test('Missing five-check report never manufactures individual outcomes and differs from historical issuance', async () => {
  await render({
    ...ssnReceipt,
    fiveChecks: null,
    issuance: 'unavailable',
    reportedOutcome: 'unavailable',
    replayed: true,
  });
  expect(words()).toContain(t('ssn.result.noReport'));
  expect(words()).not.toContain(t('ssn.result.check.deathMasterFile'));
  expect(section(t('ssn.result.checksTitle')).findAllByType(ValueRow)).toHaveLength(1);
  await act(async () => {
    view.update(
      <SSNResultDetails receipt={{ ...ssnReceipt, reportKind: 'issuanceOnly', fiveChecks: null }} />,
    );
  });
  expect(words()).toContain(t('ssn.summary.historical'));
  expect(words()).toContain(t('ssn.result.issuanceOnly'));
  expect(words()).not.toContain(t('ssn.result.noReport'));
  expect(words()).not.toContain(t('ssn.summary.fiveSatisfied'));
});

test('sensitive provider findings are opened through native details, not rendered in React', async () => {
  const session = mockSession({
    ssnDetails: jest.fn(async (_copy: DocumentCustodyPresentation) => ({
      state: 'ready' as const,
      attempt: null,
      receipt: ssnReceipt,
      failure: null,
      recoveryNeeded: false,
      busy: false,
    })),
  });
  await act(async () => {
    view = create(<SSNResultDetails receipt={ssnReceipt} session={session} />);
  });
  expect(words()).not.toContain('ssn.result.region');
  await act(async () => {
    await invoke(view.root.findByProps({ testID: 'ssn-native-details' }), 'onPress');
    await settle();
  });
  expect(session.ssnDetails).toHaveBeenCalledTimes(1);
  expect(required(session.ssnDetails.mock.calls[0])[0].strings.detailsTitle).toBe('SSN check details');
  expect(section(t('ssn.result.diagnostics')).findAllByType(ValueRow)).toHaveLength(1);
});

test('an affirmative aggregate cannot hide an incomplete five-check report', async () => {
  await render({ ...ssnReceipt, reportedOutcome: 'affirmative' });
  expect(words()).toContain(t('ssn.summary.fiveIncomplete'));
  expect(words()).not.toContain(t('ssn.summary.fiveSatisfied'));
});
