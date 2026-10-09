import { useState } from 'react';
import { Linking } from 'react-native';
import { t } from './locales/i18n';
import { copy, pageDoc, type SensorPage, title } from './SensorPresentation';
import { LinkRow, ListRow, ListSection, TextRow } from './ui/List';
import { NativeSheet } from './ui/NativeSheet';

/** A sensor's documentation, as SensorHost's page sections show it: Apple's APIs, the permission,
 * the hardware and how it updates, each a row that opens Apple's page; then what the values mean,
 * what they cannot do, and, where the SDK computes the value, how, on a sheet of its own. */
export function SensorDocuments({
  page,
  onFailure,
}: {
  page: SensorPage;
  onFailure: (message: string) => void;
}) {
  const docs = pageDoc(page);
  const [algorithm, setAlgorithm] = useState(false);
  if (!docs) return null;
  const link = (url: string) => {
    Linking.openURL(url).catch(() => onFailure(t('sensors.docs.openFailed')));
  };
  const appleSays = copy('page.footer.appleSays');
  return (
    <>
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
      <ListSection header={copy('page.header.about')} headerIcon={null}>
        {docs.noteKeys.map((key) => (
          <TextRow key={key} text={copy(key)} />
        ))}
      </ListSection>
      <ListSection header={copy('page.header.limits')} headerIcon={null}>
        {docs.limitKeys.map((key) => (
          <TextRow key={key} text={copy(key)} tone="warning" />
        ))}
      </ListSection>
      <ListSection>
        {docs.algorithmKeys.length > 0 ? (
          <ListRow
            label={t('sensors.docs.howWorkedOut', { title: title(page) })}
            onPress={() => setAlgorithm(true)}
          />
        ) : null}
      </ListSection>
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
