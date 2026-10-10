import { StyleSheet, View } from 'react-native';
import { t } from './locales/i18n';
import { copy } from './SensorPresentation';
import { ContentRow, TextRow } from './ui/List';
import { border, color, radius, size } from './ui/tokens.generated';

type Point = { x: number; y: number };
/** Drawing geometry only. The native comparison remains authoritative; no pressure calculation. */
function line(start: Point, end: Point) {
  const width = Math.hypot(end.x - start.x, end.y - start.y);
  return {
    left: (start.x + end.x - width) / 2,
    top: (start.y + end.y) / 2,
    width,
    transform: [{ rotate: `${Math.atan2(end.y - start.y, end.x - start.x)}rad` }],
  };
}
export function AirCheckDiagram({ residual, tolerance }: Readonly<{ residual: number; tolerance: number }>) {
  if (!Number.isFinite(residual) || !Number.isFinite(tolerance) || tolerance <= 0) return null;
  const scale = Math.min(
    size.fusionMaximumScale,
    Math.max(size.fusionMinimumScale, Math.abs(residual) / tolerance),
  );
  const middle = size.fusionDiagram / 2;
  const ring = size.fusionRing / 2;
  const anchors: Point[] = [
    { x: 0, y: middle - ring },
    { x: size.fusionDiagram, y: middle - ring },
    { x: middle, y: size.fusionDiagram },
  ];
  const vertices = anchors.map((anchor) => {
    const dx = anchor.x - middle,
      dy = anchor.y - middle;
    const length = Math.hypot(dx, dy);
    return { x: middle + (dx / length) * ring * scale, y: middle + (dy / length) * ring * scale };
  });
  const tone = Math.abs(residual) <= tolerance ? color.swiftGreen : color.warning;
  return (
    <ContentRow>
      <View
        style={styles.diagram}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.ring} />
        {vertices.map((vertex, index) => {
          const anchor = anchors[index],
            next = vertices[(index + 1) % vertices.length];
          return (
            <View key={index === 0 ? 'position' : index === 1 ? 'weather' : 'barometer'} style={styles.layer}>
              {anchor ? <View style={[styles.stroke, line(anchor, vertex)]} /> : null}
              {next ? <View style={[styles.stroke, { backgroundColor: tone }, line(vertex, next)]} /> : null}
            </View>
          );
        })}
      </View>
      <TextRow
        text={['airCheck.witness.position', 'airCheck.witness.areaReport', 'airCheck.witness.barometer']
          .map((key) => copy(key))
          .join(t('common.listSeparator'))}
      />
      <TextRow text={copy('airCheck.hat.caption')} />
      <TextRow text={t('fusionUI.diagram', { residual, allowance: tolerance })} />
    </ContentRow>
  );
}
const styles = StyleSheet.create({
  diagram: { width: size.fusionDiagram, height: size.fusionDiagram, alignSelf: 'center' },
  layer: { position: 'absolute', top: 0, left: 0 },
  ring: {
    position: 'absolute',
    width: size.fusionRing,
    height: size.fusionRing,
    left: (size.fusionDiagram - size.fusionRing) / 2,
    top: (size.fusionDiagram - size.fusionRing) / 2,
    borderRadius: radius.full,
    borderWidth: border.hairline,
    borderColor: color.secondaryText,
  },
  stroke: { position: 'absolute', height: border.hairline, backgroundColor: color.secondaryText },
});
