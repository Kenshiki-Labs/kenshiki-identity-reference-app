# Live nonproduction reference host

This composition connects the React host's selected, checked driver's license to the existing
Worker phone service, backed by Camara's Twilio/Vonage integrations. The owner has authorized
these suppliers for nonproduction use. Their retention qualification remains a production task.

The shipped binary SDK remains provider-neutral. This build compiles its runtime sources and
host adapters into one framework, so it does not link a second copy of SDK custody modules into
the app. Licensed reader files and supplier credentials are not part of this directory.

Prerequisites: Xcode, XcodeGen, Python with PyYAML, Ruby with xcodeproj, a generated React host,
and licensed Regula resources matching the pinned packages. Use a disposable host directory.

1. Run `generate-project.py /absolute/build-project`.
2. Build its `IdentityCaptureRuntime` scheme for Release/iphoneos into a separate DerivedData
   directory. The generated project retains the SDK's pinned package dependencies.
3. Run `configure-host.py /absolute/host /absolute/DerivedData/Build/Products/Release-iphoneos
   /absolute/licensed/Regula` (one command). The resources directory must contain
   `regula.license`, `db.dat`, and `regula-provenance.json`.
4. Build the host with its registered bundle identifier and distribution profile. Its signed
   App Attest entitlement is `production`; that exact team/bundle must be allowed by the Worker.

The configuration script replaces the disposable host's device framework slice, embeds the
reader frameworks/resources, and enables `KENSHIKI_LIVE_REFERENCE`. This is a source-built
integration, not verification of an unchanged delivery tarball. Do not publish that modified
node_modules tree as the binary SDK.

The licensed reader receives the selected original and the SDK-prepared raster from the same
open encrypted custody. Each analysis is retained before observations are used. Registration
occurs during consented document dispatch. Phone context restoration only reads the retained
installation identity and accepted document result; it cannot register or perform a check.

Phone remains blocked until the currently selected document has a native `recordMatched`
result. The UI passes its opaque capture ID when opening the separate phone session. A native
registry weakly references the document session that already owns that selection; released,
replaced, or ambiguous ownership is rejected before and after custody restoration. An unchecked replacement cannot inherit readiness. Native code checks the installation,
operation, and submitted fields before and after service calls. A passport-only result is not an
accepted document-binding source in the current Worker contract. Phone custody belongs to the
runtime session; the adapter does not open a second evidence store.

The bound five-check SSN provider is a separate composition step. Merely enabling this phone
provider does not configure or unlock an unavailable SSN service.
