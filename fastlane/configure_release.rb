require 'json'
require 'xcodeproj'

host, report_path, revision, artifact_sha, reference_sha, version, build, sdk_revision = ARGV
raise 'Expected host, preflight report, revision, artifact hash, reference hash, version, build' unless build
raise 'Invalid version' unless version.match?(/\A\d+\.\d+(?:\.\d+)?\z/)
raise 'Invalid build number' unless build.match?(/\A[1-9]\d*\z/)
report = JSON.parse(File.read(report_path))
raise 'Preflight did not pass' unless report.fetch('status') == 'prerequisites_present'
profile = report.fetch('selected_profile')
project = Xcodeproj::Project.open(File.join(host, 'ios/IdentitySDKHost.xcodeproj'))
app = project.targets.find { |target| target.name == 'IdentitySDKHost' }
raise 'Missing app target' unless app
release = app.build_configurations.find { |configuration| configuration.name == 'Release' }
raise 'Missing Release configuration' unless release
release.build_settings.merge!({
  'PRODUCT_BUNDLE_IDENTIFIER' => report.fetch('bundle_id'),
  'DEVELOPMENT_TEAM' => report.fetch('team'),
  'CODE_SIGN_STYLE' => 'Manual',
  'CODE_SIGN_IDENTITY' => profile.fetch('certificate_sha1'),
  'PROVISIONING_PROFILE_SPECIFIER' => profile.fetch('uuid'),
  'MARKETING_VERSION' => version,
  'CURRENT_PROJECT_VERSION' => build,
  'DEBUG_INFORMATION_FORMAT' => 'dwarf-with-dsym'
})
entitlements_relative = release.build_settings.fetch('CODE_SIGN_ENTITLEMENTS')
entitlements_path = File.expand_path(entitlements_relative, File.join(host, 'ios'))
raise 'Entitlements path escapes host' unless entitlements_path.start_with?(File.expand_path(host) + '/')
entitlements = Xcodeproj::Plist.read_from_path(entitlements_path)
entitlements.merge!(report.fetch('required_entitlements'))
Xcodeproj::Plist.write_to_path(entitlements, entitlements_path)
info_path = File.join(host, 'ios/IdentitySDKHost/Info.plist')
info = Xcodeproj::Plist.read_from_path(info_path)
info.merge!({'AppSourceRevision' => revision, 'SDKSourceRevision' => sdk_revision || revision, 'SDKArtifactSHA256' => artifact_sha,
             'SDKReferenceManifestSHA256' => reference_sha})
# Do not invent an export-compliance declaration. The owner may supply its reviewed answer.
if ENV.key?('SDK_USES_NON_EXEMPT_ENCRYPTION')
  answer = ENV.fetch('SDK_USES_NON_EXEMPT_ENCRYPTION')
  raise 'SDK_USES_NON_EXEMPT_ENCRYPTION must be true or false' unless ['true', 'false'].include?(answer)
  info['ITSAppUsesNonExemptEncryption'] = answer == 'true'
end
Xcodeproj::Plist.write_to_path(info, info_path)
project.save
puts "Configured #{report.fetch('bundle_id')} #{version} (#{build}) with App Store profile #{profile.fetch('uuid')}"
