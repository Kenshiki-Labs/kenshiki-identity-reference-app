# iOS React Native reference app

This adopter-owned UI installs the **built npm tarball**, not an SDK source checkout. It offers
passport MRZ capture and review → passport NFC → paired TrueDepth selfie → local face comparison.
The screens and controller are reusable reference source for SSA's app. The native SDK remains
usable without this UI. Copy, branding, navigation and enrollment decisions belong to the adopter.

All app recovery and restart prompts use an in-view bottom sheet. Apple still presents its own
camera permission and NFC system UI. The app starts idle; capture follows an explicit action.
Backgrounding cancels work and requires an explicit resume. Restart and unmount release the native
session and its evidence. The demo never calls `exportPassport`, persists captures or uploads data.

`Hosts/SensorHost` (Kenshiki Sensors) also has a native Passport tab using the public Swift APIs.
This React Native app specifically tests the distributed artifact through the JavaScript bridge.
Physical acceptance in either host is evidence for that path; it does not substitute for testing
the other integration.

## Generate a separate host

Requires Node 22.11+, CocoaPods, Xcode and an iOS 18+ target. The tested baseline is React Native
0.87.1 / React 19.2.3. SSA's actual React Native version and Expo/bare setup remain unknown.

```sh
python3 create-host.py /absolute/new/IdentitySDKHost /absolute/kenshiki-identity-capture-0.1.0.tgz
```

For a device journey, pass explicit `--trust-anchors /path/master-list.pem`,
`--embedder /path/embedder.mlmodelc` and `--detector /path/detector.mlmodelc` inputs. These are copied
into the generated host's `CaptureResources` folder. Its AppDelegate supplies their URLs to the
React Native root; the SDK does not search the host bundle. Supply properly licensed compiled
models and the intended passport trust anchors. Neither is included in the deliverable.

The script writes camera/NFC usage descriptions, the passport AID and TAG entitlement. For device
installation, set the generated app's bundle identity and signing team and enable NFC Tag Reading
in its provisioning profile. Do not reuse a production app identity to run this disposable demo.

## Checks

```sh
cd /absolute/new/IdentitySDKHost
npx tsc --noEmit
npx jest --runInBand CaptureFlowController.test.ts
cd ios
xcodebuild test -workspace IdentitySDKHost.xcworkspace -scheme IdentitySDKHost \
  -configuration Release -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

The controller tests use an explicit mocked SDK to exercise UI ownership and late-result fencing.
The UI tests run the real installed native artifact: ten bridge checks, plus unavailable-camera
recovery and restart through the rendered React Native screens. Neither proves live camera/NFC
behavior. Release builds bundle JavaScript and need no Metro server at runtime.

For physical acceptance, scan and review a passport, read its chip, test pull-away recovery and
cancellation, then capture and compare a real selfie. Repeat after backgrounding and restarting.
Check unsupported TrueDepth hardware fails closed. Record exact artifact hashes, device/OS and
observations without copying personal data into logs. VoiceOver focus, large text and localized
copy need acceptance in SSA's app; this reference flow is not a production accessibility claim.
