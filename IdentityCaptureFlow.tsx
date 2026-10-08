import React, {useEffect, useState} from 'react';
import {AppState, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {IdentityCapturePreview, IdentityCaptureSession} from '@kenshiki/identity-capture';
import type {Configuration} from '@kenshiki/identity-capture';
import {CaptureFlowController, type FlowState} from './CaptureFlowController';

/** Optional adopter UI: copy, styling and journey decisions live here, outside the native SDK.
 * Mount a fresh flow when configuration changes. Unmount releases all native evidence. */
export function IdentityCaptureFlow({configuration, onExit}: {configuration: Configuration; onExit: () => void}) {
  const [state, setState] = useState<FlowState>({phase: 'intro', busy: false, ready: false, preview: 0});
  const [controller, setController] = useState<CaptureFlowController>();
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const active = new CaptureFlowController(IdentityCaptureSession.create, configuration, setState);
    setController(active); setState(active.state);
    // iOS inactive also covers system presentations; background is the explicit leave-app boundary.
    // https://reactnative.dev/docs/appstate
    const listener = AppState.addEventListener('change', next => { if (next === 'background') void active.pause(); });
    return () => { listener.remove(); void active.dispose(); };
  }, [configuration]);
  if (!controller) return <View style={styles.root} />;
  const {phase, sheet} = state;
  const camera = phase === 'scanning' || phase === 'selfie';
  const title = phase === 'intro' ? 'Check your passport' : phase === 'scanning' ? 'Scan the printed details' :
    phase === 'review' ? 'Review your details' : phase === 'reading' ? 'Read the passport chip' :
    phase === 'passport' ? 'Passport read' : phase === 'result' ? 'Comparison complete' :
    phase === 'captured' ? 'Selfie captured' : phase === 'comparing' ? 'Comparing your photos' : 'Take a selfie';
  function action(label: string, press: () => unknown, disabled = false, id?: string) {
    return <Action label={label} onPress={press} disabled={state.busy || disabled} testID={id} />;
  }
  return <View style={styles.root}>
    <ScrollView accessibilityElementsHidden={!!sheet} importantForAccessibility={sheet ? 'no-hide-descendants' : 'auto'}
      contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>IDENTITY CHECK</Text>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {phase === 'intro' && <>
        <Text style={styles.body}>Have your passport ready. We will scan its printed details, read its chip, then compare its photo with a selfie.</Text>
        <Text style={styles.body}>Starting allows this check to use your camera. Reading the chip begins only when you choose to continue. Captures stay on this phone in this demo.</Text>
        {action('Start passport scan', controller.scan, false, 'start-passport-scan')}
      </>}
      {camera && <>
        <Text style={styles.body}>{phase === 'scanning' ? 'Open the photo page. Keep both lines of letters and numbers at the bottom in view.' : state.hint}</Text>
        <View style={styles.camera} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
          {state.session && <IdentityCapturePreview key={`${phase}-${state.preview}`} session={state.session}
            kind={phase === 'scanning' ? 'mrz' : 'selfie'} style={StyleSheet.absoluteFill} />}
          <View pointerEvents="none" style={styles.guideCenter}>
            {phase === 'selfie' ? <View style={[styles.oval, {width: width * .68, height: width * .68 * 1.3}]} /> :
              <View style={styles.mrzGuide} />}
          </View>
        </View>
        {phase === 'scanning' ? <>
          <Text style={styles.body}>{state.mrz?.completeness === 'complete' ? 'Printed details found.' : 'Keep the whole photo page in view.'}</Text>
          {action('Review details', controller.review, state.mrz?.completeness !== 'complete')}
        </> : action('Capture selfie', controller.capture, !state.ready)}
      </>}
      {phase === 'review' && state.mrz && <>
        <Text style={styles.body}>Check these details against your passport before reading its chip.</Text>
        <Details label="Name" value={`${state.mrz.givenNames} ${state.mrz.surname}`.replace(/<+/g, ' ')} />
        <Details label="Passport number" value={state.mrz.documentNumber} />
        <Details label="Date of birth (YYMMDD)" value={state.mrz.birthDateYYMMDD} />
        <Details label="Expiry date (YYMMDD)" value={state.mrz.expiryDateYYMMDD} />
        <Text style={styles.body}>Hold the top of your phone against the passport and keep it still until the read completes.</Text>
        {action('Read passport chip', controller.read)}
        {action('Scan again', controller.scan)}
      </>}
      {phase === 'reading' && <Text style={styles.body} accessibilityLiveRegion="polite">{state.progress}</Text>}
      {phase === 'passport' && state.passport && <>
        <Text style={styles.body}>The chip was read and its signed data was checked.</Text>
        <Text style={styles.body}>{state.passport.portraitAvailable ? 'Next, take a selfie to compare with the passport photo.' : 'A usable passport photo was not available. Scan and read the passport again.'}</Text>
        {action('Continue to selfie', controller.selfie, !state.passport.portraitAvailable)}
      </>}
      {phase === 'captured' && <>
        <Text style={styles.body}>Your selfie is ready to compare with the passport photo.</Text>
        {action('Compare photos', controller.compare)}
        {action('Retake selfie', controller.selfie)}
      </>}
      {phase === 'comparing' && <Text style={styles.body}>Keep this screen open while the photos are compared.</Text>}
      {phase === 'result' && state.comparison && <>
        <Details label="SDK comparison observation" value={state.comparison.outcome} />
        <Details label="Similarity" value={state.comparison.similarity.toFixed(3)} />
        <Text style={styles.body}>This is the capture demo’s comparison result. Enrollment decisions belong to the adopting app.</Text>
        {action('Finish and clear this check', async () => { await controller.restart(); onExit(); })}
      </>}
      {state.busy && <Text accessibilityLiveRegion="polite" style={styles.body}>Please wait…</Text>}
      {phase !== 'intro' && <Action label="Restart check" onPress={controller.requestRestart} testID="restart-check" />}
      <Action label="Close check" onPress={async () => { await controller.dispose(); onExit(); }} />
    </ScrollView>
    {sheet && <View style={styles.scrim}>
      <View accessibilityViewIsModal style={styles.sheet} testID="capture-bottom-sheet">
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{sheet.kind === 'restart' ? 'Restart this check?' : 'Let’s try that again'}</Text>
          <Text style={styles.body}>{sheet.message}</Text>
          {sheet.kind === 'restart' ? <>
            {action('Start over', controller.restart, false, 'confirm-restart')}
            {action('Keep this check', controller.recover)}
          </> : <>
            {action('Try again', controller.recover, false, 'retry-capture')}
            {action('Start over', controller.restart, false, 'confirm-restart')}
          </>}
        </ScrollView>
      </View>
    </View>}
  </View>;
}
function Details({label, value}: {label: string; value: string}) {
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text style={styles.body}>{value}</Text></View>;
}
function Action({label, onPress, disabled = false, testID}: {label: string; onPress: () => unknown; disabled?: boolean; testID?: string}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} testID={testID}
    onPress={() => { void onPress(); }} style={[styles.action, disabled && styles.disabled]}>
    <Text style={styles.actionText}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#f4f5f8'}, content: {padding: 24, gap: 20, paddingBottom: 48},
  eyebrow: {color: '#233c69', fontWeight: '700', letterSpacing: 2},
  title: {fontSize: 32, fontWeight: '700', color: '#122b54'}, body: {fontSize: 18, lineHeight: 26, color: '#252c39'},
  label: {fontSize: 14, fontWeight: '700', color: '#4d576a'}, detail: {gap: 4},
  camera: {height: 420, borderRadius: 20, overflow: 'hidden', backgroundColor: '#152032'},
  guideCenter: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center'},
  oval: {borderWidth: 3, borderColor: '#fff', borderRadius: 1000},
  mrzGuide: {width: '88%', height: 110, borderColor: '#fff', borderWidth: 2, borderRadius: 8},
  action: {backgroundColor: '#173965', padding: 16, minHeight: 52, borderRadius: 14, alignItems: 'center'},
  actionText: {color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center'}, disabled: {opacity: .45},
  scrim: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#0008', justifyContent: 'flex-end'},
  sheet: {backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%'},
  sheetContent: {padding: 28, paddingBottom: 40, gap: 22}, sheetTitle: {fontSize: 26, fontWeight: '700', color: '#122b54'},
});
