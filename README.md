# iOS React Native reference app

This adopter-owned UI installs the **built npm tarball**, not an SDK source checkout. It offers
an Identity hub with Driver licence, Passport, Face match and SSN issuance cards. Passport MRZ capture and review leads
to NFC and immediately inspectable passport results. Face match reuses that passport photo;
paired TrueDepth capture automatically starts the local comparison.
The screens and controller are reusable reference source for SSA's app. The native SDK remains
usable without this UI. Copy, branding, navigation and enrollment decisions belong to the adopter.

All app recovery and restart prompts use an in-view bottom sheet. Apple still presents its own
camera permission and NFC system UI. The app starts idle; capture follows an explicit action.
Backgrounding cancels active work and requires an explicit resume. Cancelling Apple's NFC sheet
quietly returns to the printed details. Camera and comparison failures offer targeted retry while
keeping a successful passport read. Restart clears the check.
Interruption waits for native cancellation and the active JavaScript command to settle. If a read or
comparison completed before cancellation won, its committed observations replace the prior result
before review becomes available; the interrupted camera screen is never reopened by that delivery.

`IdentityCaptureFlow.onComplete(result)` transfers ownership of its live native session to the
adopter before unmount. `CompletedCapture` includes the passport/protocol observations, printed/chip
correspondence, optional comparison and its receipt, and the session handle. The receiving app must
call `result.session.release()` when clearing the result or ending its owning scope. Unmounting the
completed flow does not release transferred evidence. Cancelling an unfinished flow does release it.
Do not retain only the observations and then release the session if you still need image review.

The demo holds one result in memory and reopens it from either Identity card; app termination clears
it. Explicit Clear results uses a bottom sheet. `IdentityCaptureImage` renders the hash-bound passport
photo and selfie directly from native memory, and release blanks mounted image views. Chip fields,
independent protocol outcomes and measured depth details remain available in the results view.
Passport/face review stays in memory in the RN bridge. Driver licence captures use the native
encrypted document store and reopen from saved IDs; the app never calls `exportPassport`.
The SSN card is independent of document capture and phone verification. The adopting app registers
its native provider through `IDCaptureRegisterSSNIssuanceProvider`, then supplies `ssn.context.credentialID`,
a stable `workflowID`, the registered `providerID` and dedicated directory/Keychain custody names.
Authentication and service signing stay in native code; the JavaScript configuration has no bearer
token or gateway credentials. Without a provider/configuration the card reports service unavailable
and sends no request. See the [package integration guide](../../ReactNative/identity-capture/README.md#optional-ssn-issuance-flow).

The SDK owns exact-digit confirmation, encrypted phone-only retention and local recovery. The UI
does not checkpoint entered digits; the native journal retains the exact confirmed number and reply,
without exporting saved digits on reopening. A missing response cannot be fetched remotely or retried
automatically. A new check after uncertainty requires a separate confirmation explaining that the
previous request may already have happened. Local-save recovery sends nothing to the provider.
SSN confirmation, failure and recovery use bottom sheets and results say issuance, not ownership.

`Hosts/SensorHost` (Kenshiki Sensors) also has native Identity cards using the public Swift APIs.
This React Native app specifically tests the distributed artifact through the JavaScript bridge.
Physical acceptance in either host is evidence for that path; it does not substitute for testing
the other integration.

## Generate a separate host

Requires Node 22.11+, CocoaPods, Xcode and an iOS 18+ target. The tested baseline is React Native
0.87.1 / React 19.2.3. SSA's actual React Native version and Expo/bare setup remain unknown.

```sh
python3 create-host.py /absolute/new/IdentitySDKHost /absolute/kenshiki-identity-capture-0.3.0.tgz
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
npx jest --runInBand CaptureFlowController.test.ts IdentityCaptureFlow.test.tsx DocumentFlowController.test.ts DriverLicenseFlow.test.tsx SSNFlowController.test.ts SSNFlow.test.tsx
cd ios
xcodebuild test -workspace IdentitySDKHost.xcworkspace -scheme IdentitySDKHost \
  -configuration Release -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-
```

The controller tests use an explicit mocked SDK to exercise result handoff, targeted recovery,
automatic comparison and late-result fencing. A rendered React test completes a passport read,
returns to Identity and reopens results without rescanning or prematurely releasing evidence.
The UI tests target the installed native artifact: twelve bridge checks, unavailable document/MRZ
camera recovery, an unavailable-SSN-service bottom sheet, and synthetic standalone SSN confirmation,
result and reopening. The 0.3 artifact validation is in progress; these test definitions are not a
claim that the final 0.3 package has passed.

For the synthetic SSN test only, AppDelegate registers a fixture when launched with
`--ssn-artifact-fixture`. It is compiled only for the simulator, accepts only the invalid synthetic
number `000-00-1234`, and makes no network request. It cannot be enabled in a physical-device build.
This proves neither live provider behavior nor supplier non-retention. Ordinary launches require
the adopter's real native provider. The simulator host uses ad hoc signing because custody uses the
real Keychain. Release builds bundle JavaScript and need no Metro server at runtime.

For physical acceptance, scan and review a passport, read its chip, test pull-away recovery and
cancellation, then capture and compare a real selfie. Repeat after backgrounding and restarting.
Check unsupported TrueDepth hardware fails closed. Record exact artifact hashes, device/OS and
observations without copying personal data into logs. VoiceOver focus, large text and localized
copy need acceptance in SSA's app; this reference flow is not a production accessibility claim.
