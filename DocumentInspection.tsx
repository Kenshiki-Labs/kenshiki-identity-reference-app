import { IdentityDocumentInspection } from '@kenshiki/identity-capture';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SavedDocumentCapture } from './DocumentFlowController';
import { t } from './locales/i18n';
import { styles } from './ui/styles';
import { color, radius, size, spacing, text } from './ui/tokens.generated';

type Side = 'front' | 'back';
type Representation = 'original' | 'normalized' | 'spatial';

/** A selection belongs to one retained document. Replacement and holder changes start again
 * at the original; an old side or projection never silently carries into another capture. */
export function DocumentInspection({ result }: Readonly<{ result: SavedDocumentCapture }>) {
  const { document, session } = result;
  const identity = JSON.stringify([
    session.id,
    document.workflowID,
    document.front?.captureID,
    document.front?.sha256,
    document.back?.captureID,
    document.back?.sha256,
  ]);
  return <InspectionContent key={identity} result={result} />;
}

function InspectionContent({ result }: Readonly<{ result: SavedDocumentCapture }>) {
  const { document, session } = result;
  const [side, setSide] = useState<Side>(document.front ? 'front' : 'back');
  const [representation, setRepresentation] = useState<Representation>('original');
  const selected = document[side];
  const imageLabel = t('inspection.image', {
    side: t(`license.result.${side}`),
    representation: t(`inspection.${representation}`),
  });
  return (
    <>
      <View style={styles.card} testID="document-result">
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          {t('inspection.title')}
        </Text>
        <View style={inspectionStyles.choices}>
          {(['front', 'back'] as const)
            .filter((value) => !!document[value])
            .map((value) => (
              <Choice
                key={value}
                label={t(`license.result.${value}`)}
                selected={side === value}
                testID={`inspect-${value}`}
                onPress={() => setSide(value)}
              />
            ))}
        </View>
        <View style={inspectionStyles.choices}>
          {(['original', 'normalized', 'spatial'] as const).map((value) => (
            <Choice
              key={value}
              label={t(`inspection.${value}`)}
              selected={representation === value}
              testID={`inspect-${value}`}
              onPress={() => setRepresentation(value)}
            />
          ))}
        </View>
        {selected ? (
          <IdentityDocumentInspection
            key={`${side}:${representation}:${selected.captureID}:${selected.sha256}`}
            session={session}
            side={side}
            representation={representation}
            sha256={selected.sha256}
            accessibilityLabel={imageLabel}
            presentation={{
              loading: t('inspection.loading'),
              inactive: t('inspection.inactive'),
              deselected: t('inspection.deselected'),
              missing: t(representation === 'spatial' ? 'inspection.spatialMissing' : 'inspection.missing'),
              failed: t('inspection.failed'),
              resourceLimited: t('inspection.resourceLimited'),
              imageLabel,
            }}
            style={inspectionStyles.image}
          />
        ) : (
          <Text style={styles.body}>{t('inspection.noCapture')}</Text>
        )}
        <Text style={styles.label}>{t(`inspection.${representation}Explanation`)}</Text>
        <Text style={styles.label}>{t('inspection.zoom')}</Text>
        {!document.back && <Text style={styles.body}>{t('license.result.backNeeded')}</Text>}
      </View>
      {document.front && <DocumentPortrait result={result} />}
    </>
  );
}

/** This pane requests the document's retained portrait, never a selfie or passport reference. */
function DocumentPortrait({ result }: Readonly<{ result: SavedDocumentCapture }>) {
  const front = result.document.front;
  if (!front) return null;
  const imageLabel = t('inspection.portrait');
  return (
    <View style={styles.card} testID="document-portrait">
      <Text accessibilityRole="header" style={styles.sheetTitle}>
        {imageLabel}
      </Text>
      <IdentityDocumentInspection
        session={result.session}
        side="front"
        representation="portrait"
        sha256={front.sha256}
        accessibilityLabel={imageLabel}
        presentation={{
          loading: t('inspection.loading'),
          inactive: t('inspection.inactive'),
          deselected: t('inspection.deselected'),
          missing: t('inspection.portraitMissing'),
          failed: t('inspection.failed'),
          imageLabel,
        }}
        style={inspectionStyles.image}
      />
      <Text style={styles.label}>{t('inspection.portraitExplanation')}</Text>
    </View>
  );
}

function Choice({
  label,
  selected,
  testID,
  onPress,
}: Readonly<{
  label: string;
  selected: boolean;
  testID: string;
  onPress: () => void;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      onPress={onPress}
      style={[inspectionStyles.choice, selected && inspectionStyles.selected]}
    >
      <Text style={[inspectionStyles.choiceText, selected && inspectionStyles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const inspectionStyles = StyleSheet.create({
  choices: { flexDirection: 'row', gap: spacing.xs },
  choice: {
    flex: 1,
    minHeight: size.touchTarget,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.group,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: color.tint },
  choiceText: { ...text.plainAction, color: color.tint, textAlign: 'center' },
  selectedText: { color: color.onTint },
  image: { height: size.documentInspectionHeight },
});
