import { useState } from 'react';
import { Linking } from 'react-native';
import { t } from '../locales/i18n';
import { copy, pageDoc, type SensorPage, title } from './SensorPresentation';
import { LinkRow, ListRow, ListSection, TextRow } from '../ui/List';
import { NativeSheet } from '../ui/NativeSheet';

import { Page } from '../ui/Page';
import { PageLead } from '../ui/PageLead';

/** Native L3 reference page. Link failures stay here, separate from sensor collection failures. */
export function SensorDocumentationScreen({ page }: Readonly<{ page: SensorPage }>) {
  const docs = pageDoc(page);
  const [failure, setFailure] = useState(false);
  const link = (url: string) => {
    setFailure(false);
    Linking.openURL(url).catch(() => setFailure(true));
  };
  const appleSays = copy('page.footer.appleSays');
  return (
    <Page
      title={t('sensors.docs.open')}
      testID="sensor-documentation"
      lead={
        <PageLead
          title={t('sensors.docs.title', { title: title(page) })}
          description={t('sensors.docs.description')}
        />
      }
    >
      {failure ? (
        <ListSection>
          <TextRow text={t('sensors.docs.openFailed')} tone="warning" alert />
        </ListSection>
      ) : null}
      {docs ? (
        <>
          {docs.apis.length > 0 ? (
            <ListSection header={copy('page.header.apis')} headerIcon={null} footer={appleSays}>
              {docs.apis.map((api) => (
                <LinkRow
                  key={api.url}
                  code={api.symbol}
                  caption={api.framework}
                  quote={api.abstractKey ? copy(api.abstractKey) : undefined}
                  onPress={() => link(api.url)}
                />
              ))}
            </ListSection>
          ) : null}
          {docs.usageKey || docs.checks.length > 0 ? (
            <ListSection header={copy('page.header.permission')} headerIcon={null} footer={appleSays}>
              {docs.usageKey ? (
                <LinkRow
                  code={docs.usageKey.key}
                  caption={copy('page.row.infoPlistKey')}
                  quote={copy(docs.usageKey.quoteKey)}
                  onPress={() => {
                    if (docs.usageKey) link(docs.usageKey.url);
                  }}
                />
              ) : null}
              {docs.checks.map((check) => (
                <LinkRow
                  key={check.url}
                  code={check.symbol}
                  quote={copy(check.quoteKey)}
                  onPress={() => link(check.url)}
                />
              ))}
            </ListSection>
          ) : null}
          {(
            [
              ['hardware', copy('page.header.hardware'), docs.hardware],
              ['updates', copy('page.header.updates'), docs.updates],
            ] as const
          ).map(([key, heading, entry]) =>
            entry ? (
              <ListSection key={key} header={heading} headerIcon={null} footer={appleSays}>
                <LinkRow quote={copy(entry.quoteKey)} onPress={() => link(entry.url)} />
              </ListSection>
            ) : null,
          )}
        </>
      ) : null}
    </Page>
  );
}

/** Reading interpretation and limits belong beside the observations on L2. */
export function SensorExplanation({ page }: Readonly<{ page: SensorPage }>) {
  const docs = pageDoc(page);
  const [algorithm, setAlgorithm] = useState(false);
  if (!docs) return null;
  return (
    <>
      {docs.noteKeys.length > 0 ? (
        <ListSection header={copy('page.header.about')} headerIcon={null}>
          {docs.noteKeys.map((key) => (
            <TextRow key={key} text={copy(key)} />
          ))}
        </ListSection>
      ) : null}
      {docs.limitKeys.length > 0 ? (
        <ListSection header={copy('page.header.limits')} headerIcon={null}>
          {docs.limitKeys.map((key) => (
            <TextRow key={key} text={copy(key)} tone="warning" />
          ))}
        </ListSection>
      ) : null}
      {docs.algorithmKeys.length > 0 ? (
        <ListSection>
          <ListRow
            label={t('sensors.docs.howWorkedOut', { title: title(page) })}
            onPress={() => setAlgorithm(true)}
          />
        </ListSection>
      ) : null}
      {algorithm ? (
        <NativeSheet title={title(page)} onDismiss={() => setAlgorithm(false)}>
          <ListSection>
            {docs.algorithmKeys.map((key, index) => (
              <TextRow key={key} text={t('sensors.docs.step', { number: index + 1, text: copy(key) })} />
            ))}
            {docs.algorithmCode ? <TextRow text={docs.algorithmCode} /> : null}
          </ListSection>
        </NativeSheet>
      ) : null}
    </>
  );
}
