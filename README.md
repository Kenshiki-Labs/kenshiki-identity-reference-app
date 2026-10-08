# iOS React Native reference app

This adopter-owned UI installs the **built npm tarball**, not an SDK source checkout. It offers
an Identity hub with Driver licence, Passport, Face match, SSN issuance and Phone cards. Passport MRZ capture and review leads
to NFC and immediately inspectable passport results. Face match reuses that passport photo;
paired TrueDepth capture automatically starts the local comparison.
The screens and controller are reusable reference source for SSA's app. The native SDK remains
usable without this UI. Copy, branding, navigation and enrollment decisions belong to the adopter.

All app recovery and restart prompts use an in-view bottom sheet. Apple still presents its own
camera permission and NFC system UI. The app starts idle; capture follows an explicit action.
Backgrounding cancels active work and requires an explicit resume. Cancelling Apple's NFC sheet
quietly returns to the printed details. Camera and comparison failures offer targeted retry while
keeping a successful passport read. Restart starts a new workflow and preserves previously saved results.
Interruption waits for native cancellation and the active JavaScript command to settle. If a read or
comparison completed before cancellation won, its committed observations replace the prior result
before review becomes available; the interrupted camera screen is never reopened by that delivery.

`IdentityCaptureFlow.onComplete(result)` transfers ownership of its live native session to the
adopter before unmount. `CompletedCapture` includes the passport/protocol observations, printed/chip
correspondence, optional comparison and its receipt, and the session handle. The receiving app must
call `result.session.release()` when clearing the result or ending its owning scope. Unmounting the
completed flow does not release transferred evidence. Cancelling an unfinished flow does release it.
Do not retain only the observations and then release the session if you still need image review.

The AppDelegate configures encrypted passport/face custody in the app's private support directory
with a dedicated Keychain identity. The Identity hub restores a single saved passport on startup;
when several workflows exist, opening its card offers a saved-result picker. Face results reopen
only with the matching passport portrait. Release clears decrypted images, and relaunch can reopen
the encrypted records without acquisition. An explicit bottom sheet confirms erasing all passport
and face records, images and their key. A failed local save offers saving again without repeating
the completed hardware check. The optional SDK configuration also supports transient-only callers.

`IdentityCaptureImage` renders hash-bound passport photos and selfies from native memory.
Chip fields, independent protocol outcomes and depth details remain available in the results view.
Driver licence captures and document-check journals share the native encrypted document store;
the app never calls `exportPassport`. A configured native document provider enables
`DocumentCheckPanel` on the completed licence screen. It shows the actual returned checks and
submitted fields, opens saved replies locally, and offers explicit reconciliation and requested
corrections. Wrap this panel in `IdentitySheetHost` above scroll/navigation content so recovery and
correction sheets attach to the screen bottom. Without a provider it accurately reports unavailable.
See the [document provider contract](../../ReactNative/identity-capture/README.md#optional-document-check-06).

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
python3 create-host.py /absolute/new/IdentitySDKHost /absolute/kenshiki-identity-capture-0.6.0.tgz
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
npx jest --runInBand
cd ios
xcodebuild test -workspace IdentitySDKHost.xcworkspace -scheme IdentitySDKHost \
  -configuration Release -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-
```

The controller tests use an explicit mocked SDK to exercise result handoff, targeted recovery,
automatic comparison and late-result fencing. A rendered React test completes a passport read,
returns to Identity and reopens results without rescanning or prematurely releasing evidence.
The historical 0.3 UI tests targeted the installed native artifact: twelve bridge checks, unavailable document/MRZ
camera recovery, an unavailable-SSN-service bottom sheet, and synthetic standalone SSN confirmation,
result and reopening. All five passed against the 0.3 package built from clean commit `082088e`,
along with TypeScript checking and 61 reference-flow tests. The exact artifact hash and evidence
are recorded in [the distribution record](../../Distribution/README.md#030-standalone-ssn-correction-2026-10-08).

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

The source result screen also renders issuance region, date range, classification, source
and response codes when the native provider supplies `SSNIssuanceProviderDetails`. Those
observations survive encrypted receipt restoration and bridge into `receipt.details`.
Absent observations are labeled “Not returned”; earlier receipts explain that details were
not retained. This source update is not a claim that the earlier 0.3.0 artifact includes it.

The Phone card uses `PhoneFlowController` to preserve native session ownership, subscribe to
receipt updates and drain interrupted composition/polling before returning to Identity. Opening
saved results is local-only. It shows the received number, dates, separate subscriber outcome,
field grades and carrier observations, including missing values. See the [native provider
contract](../../ReactNative/identity-capture/README.md#phone-flow-04-source). The example requires
an approved native service and checked-document reference; none is silently selected. The current
legacy phone backend does not meet the phone-only PII requirement.

The 0.5 subscriber composition keeps that same text, wait and result journey. A registered native
`SubscriberCheckProvider`, selected with `phone.subscriberProviderID`, attaches the independent
comparison after the actual receipt. It adds no normal UI step or extra comparison button.
`SubscriberResultDetails` shows the individual grades, scope, missing evidence and whole-address
observation on the existing result screen. A lost answer remains explicit uncertainty; reopening
does not run another comparison. See the [composition contract](../../ReactNative/identity-capture/README.md#subscriber-composition-05-source).

For the 0.6 document registration test, `--document-check-artifact-fixture` registers a simulator-only
provider whose methods refuse dispatch. The installed bridge must recognize it and refuse a check
without a retained front. The 18 developer checks also exercise completed-result discovery and
erasure in separate test custody. They never erase normal user records. Full document response,
correction, cancellation and result reopening are exercised by native runtime tests using synthetic
providers. These tests do not validate a licensed reader, a live supplier or physical capture.
