# Build and ship with your Apple accounts

These lanes ship with the editable React Native reference app. They consume the delivered object-code SDK; they do not need Kenshiki's private repository, Apple account, signing identity or App Store Connect access.

Run them from the generated app directory. Install Xcode, Node, CocoaPods, Ruby with `xcodeproj`, and Fastlane. The reference generator installs the app dependencies and includes this folder, the SDK tarball, and its delivery manifest under `vendor/`. Commit the generated app, including `package-lock.json`, `ios/Podfile.lock`, `vendor/` and `fastlane/`, into your own Git repository. Keep `node_modules`, Pods, credentials and build output out of Git. Git LFS users must materialize the SDK tarball before building.

## Set up your account

Register your own bundle identifier and enable NFC Tag Reading and App Attest. Create and install an **App Store distribution** profile for that identifier and an Apple Distribution certificate with its private key in your Keychain. An Ad Hoc or development profile cannot be used by these lanes. The build requests NFC TAG and production App Attest; your servers must recognize your app identifier and production attestation environment.

Access WiFi Information is optional. It gives the sensor board the current Wi-Fi network name and familiarity token; identity capture does not use it. To include it, enable it on the identifier and set `APP_OPTIONAL_ENTITLEMENTS=wifi-info`, and the lanes then require it in the profile and the signed app. The SDK does not use WeatherKit.

Create the app record in your App Store Connect account and record its numeric Apple ID. Creating that record requires the website or Apple ID login; an App Store Connect API key does not create it. Give the upload key the access required for this app. Store its `.p8` file outside the repository.

Review the app's branding, service configuration, privacy manifest, purpose strings and encryption declaration for your deployment. This lane does not supply an export-compliance answer. If your organization has reviewed that answer, set `SDK_USES_NON_EXEMPT_ENCRYPTION=true` or `false`; otherwise the lane preserves the existing declaration and the verifier reports its status. Do not copy an answer from another app.

## Local candidate — no upload

Use your own values:

```sh
export APP_IDENTIFIER='your.organization.identity'
export APPLE_TEAM_ID='YOURTEAMID'
export APP_STORE_PROFILE='/absolute/path/to/your-app-store.mobileprovision'
export APP_REVISION="$(git rev-parse HEAD)"
export APP_VERSION='1.0'
export APP_BUILD_NUMBER='1'
export APP_RELEASE_OUTPUT='/absolute/path/outside-the-repo/candidate-1'
fastlane ios candidate
```

The output directory must not already exist. The lane requires a clean, pinned app checkout, clones that revision into the output directory, runs `npm ci` and `pod install --deployment`, configures only the clone, and archives a Release app with embedded JavaScript. It exports an IPA and verifies signatures, provisioning, entitlements, device architectures, app identity and version, source provenance, privacy manifest presence, and unchanged JavaScript between archive and export.

The app revision and SDK binary revision are distinct. `inputs.json` records `appSourceRevision` and `sdkBinarySourceCommit`; the app's Info.plist records `AppSourceRevision` and `SDKSourceRevision`. The tarball and delivery manifest hashes also travel in the receipt. Your app can evolve without pretending the SDK binary was rebuilt.

Outputs include `App.xcarchive`, `export/App.ipa`, `inputs.json`, `preflight.json` and `export-verification.json`. Keep the whole candidate directory until upload. Signature and packaging verification do **not** claim device acceptance, backend interoperability or assurance-level compliance. Complete your organization's release tests before uploading.

## Explicit upload

Keep the candidate's app source checkout unchanged, and set:

```sh
export ASC_KEY_ID='YOUR_API_KEY_ID'
export ASC_ISSUER_ID='YOUR_ISSUER_ID'
export ASC_KEY_PATH='/absolute/path/outside-the-repo/AuthKey_YOUR_API_KEY_ID.p8'
export ASC_APP_ID='YOUR_NUMERIC_APPLE_ID'
fastlane ios upload
```

`APP_RELEASE_OUTPUT` must still point to the verified candidate. Upload rechecks its exact IPA hash, source revision, recorded inputs and signature, then verifies that the API key sees the expected app record. Reused build numbers are refused. It uploads only that IPA and waits for processing. It does not submit App Review, distribute to external testers or notify external testers. App Store Connect settings under your control may make processed builds available to internal testers.

A changed app, dependency, profile or build number requires a new candidate. Do not modify verification receipts to reuse an old candidate.

## Shared verification code

`configure_release.rb`, `release_preflight.py` and `verify_export.py` are the SDK publisher's own release helpers. The SDK checkout keeps one copy of each, in its `fastlane/` folder. The reference delivery places them in this folder as ordinary files, so the generated app is self-contained. No network call to Kenshiki occurs during these lanes.
