import { useState } from 'react';
import { Linking, Modal, ScrollView, Text } from 'react-native';
import { Action } from './IdentityCaptureFlow';
import { t } from './locales/i18n';
import { boardStyles, Note, Section } from './SensorBoardRows';
import { copy, pageDoc, type SensorPage, title } from './SensorPresentation';
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
  return (
    <>
      {docs.apis.length > 0 && (
        <Section title={copy('page.header.apis')}>
          {docs.apis.map((api) => (
            <Action
              key={api.url}
              secondary
              label={t('sensors.docs.api', {
                symbol: api.symbol,
                framework: api.framework,
                abstract: api.abstractKey ? copy(api.abstractKey) : '',
              })}
              onPress={() => link(api.url)}
            />
          ))}
        </Section>
      )}
      {(docs.usageKey || docs.checks.length > 0) && (
        <Section title={copy('page.header.permission')}>
          {docs.usageKey && (
            <Action
              secondary
              label={t('sensors.docs.entry', {
                name: docs.usageKey.key,
                quote: copy(docs.usageKey.quoteKey),
              })}
              onPress={() => {
                if (docs.usageKey) link(docs.usageKey.url);
              }}
            />
          )}
          {docs.checks.map((check) => (
            <Action
              key={check.url}
              secondary
              label={t('sensors.docs.entry', { name: check.symbol, quote: copy(check.quoteKey) })}
              onPress={() => link(check.url)}
            />
          ))}
        </Section>
      )}
      {[
        [copy('page.header.hardware'), docs.hardware],
        [t('sensors.docs.updates'), docs.updates],
      ].map(([heading, entry]) =>
        typeof entry === 'object' && entry ? (
          <Section key={String(heading)} title={String(heading)}>
            <Action secondary label={copy(entry.quoteKey)} onPress={() => link(entry.url)} />
          </Section>
        ) : null,
      )}
      <Section title={t('sensors.about', { title: title(page) })}>
        {docs.noteKeys.map((key) => (
          <Note key={key} text={copy(key)} />
        ))}
      </Section>
      {docs.limitKeys.length > 0 && (
        <Section title={t('sensors.docs.limits')}>
          {docs.limitKeys.map((key) => (
            <Text key={key} style={boardStyles.warning}>
              {copy(key)}
            </Text>
          ))}
        </Section>
      )}
      {docs.algorithmKeys.length > 0 && (
        <Action
          secondary
          label={t('sensors.docs.howWorkedOut', { title: title(page) })}
          onPress={() => setAlgorithm(true)}
        />
      )}
      <Modal visible={algorithm} animationType="slide" onRequestClose={() => setAlgorithm(false)}>
        <ScrollView contentContainerStyle={boardStyles.documents}>
          <Action label={copy('common.done')} onPress={() => setAlgorithm(false)} />
          <Section title={title(page)}>
            {docs.algorithmKeys.map((key, index) => (
              <Note key={key} text={t('sensors.docs.step', { number: index + 1, text: copy(key) })} />
            ))}
            {docs.algorithmCode && (
              <Text selectable style={boardStyles.note}>
                {docs.algorithmCode}
              </Text>
            )}
          </Section>
        </ScrollView>
      </Modal>
    </>
  );
}
