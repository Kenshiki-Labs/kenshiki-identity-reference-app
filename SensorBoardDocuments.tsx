import { useState } from 'react';
import { Linking, Modal, ScrollView, Text } from 'react-native';
import { Action } from './IdentityCaptureFlow';
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
    Linking.openURL(url).catch(() => onFailure('The documentation could not be opened.'));
  };
  return (
    <>
      {docs.apis.length > 0 && (
        <Section title="Apple APIs">
          {docs.apis.map((api) => (
            <Action
              key={api.url}
              secondary
              label={`${api.symbol} · ${api.framework}\n${api.abstractKey ? copy(api.abstractKey) : ''}`}
              onPress={() => link(api.url)}
            />
          ))}
        </Section>
      )}
      {(docs.usageKey || docs.checks.length > 0) && (
        <Section title="Permission">
          {docs.usageKey && (
            <Action
              secondary
              label={`${docs.usageKey.key}\n${copy(docs.usageKey.quoteKey)}`}
              onPress={() => {
                if (docs.usageKey) link(docs.usageKey.url);
              }}
            />
          )}
          {docs.checks.map((check) => (
            <Action
              key={check.url}
              secondary
              label={`${check.symbol}\n${copy(check.quoteKey)}`}
              onPress={() => link(check.url)}
            />
          ))}
        </Section>
      )}
      {[
        ['Hardware', docs.hardware],
        ['Updates', docs.updates],
      ].map(([heading, entry]) =>
        typeof entry === 'object' && entry ? (
          <Section key={String(heading)} title={String(heading)}>
            <Action secondary label={copy(entry.quoteKey)} onPress={() => link(entry.url)} />
          </Section>
        ) : null,
      )}
      <Section title={`About ${title(page)}`}>
        {docs.noteKeys.map((key) => (
          <Note key={key} text={copy(key)} />
        ))}
      </Section>
      {docs.limitKeys.length > 0 && (
        <Section title="Limits">
          {docs.limitKeys.map((key) => (
            <Text key={key} style={boardStyles.warning}>
              {copy(key)}
            </Text>
          ))}
        </Section>
      )}
      {docs.algorithmKeys.length > 0 && (
        <Action secondary label={`How ${title(page)} is worked out`} onPress={() => setAlgorithm(true)} />
      )}
      <Modal visible={algorithm} animationType="slide" onRequestClose={() => setAlgorithm(false)}>
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          <Action label="Done" onPress={() => setAlgorithm(false)} />
          <Section title={title(page)}>
            {docs.algorithmKeys.map((key, index) => (
              <Note key={key} text={`${index + 1}. ${copy(key)}`} />
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
