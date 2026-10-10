require 'xcodeproj'
host, products = ARGV
project = Xcodeproj::Project.open(File.join(host, 'ios/IdentitySDKHost.xcodeproj'))
app = project.targets.find { |target| target.name == 'IdentitySDKHost' }
raise 'Missing reference app target' unless app
app.build_configurations.each do |config|
  config.build_settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = '$(inherited) KENSHIKI_LIVE_REFERENCE'
  config.build_settings['SWIFT_INCLUDE_PATHS'] = ['$(inherited)', products]
  config.build_settings['FRAMEWORK_SEARCH_PATHS'] = ['$(inherited)', '$(PROJECT_DIR)/LiveServiceFrameworks']
end
entitlements_path = File.join(host, 'ios/IdentitySDKHost/IdentitySDKHost.entitlements')
entitlements = Xcodeproj::Plist.read_from_path(entitlements_path)
entitlements['com.apple.developer.devicecheck.appattest-environment'] = 'production'
Xcodeproj::Plist.write_to_path(entitlements, entitlements_path)
resources = project.files.find { |ref| ref.path == 'LocalCaptureResources' } || project.main_group.new_reference('LocalCaptureResources')
resources.last_known_file_type = 'folder'
app.resources_build_phase.add_file_reference(resources, true)
embed = app.copy_files_build_phases.find { |phase| phase.name == 'Embed Live Service Frameworks' } || app.new_copy_files_build_phase('Embed Live Service Frameworks')
embed.dst_subfolder_spec = '10'
%w[DocumentReader DocumentReaderCore RegulaCommon].each do |name|
  path = "LiveServiceFrameworks/#{name}.framework"
  reference = project.files.find { |ref| ref.path == path } || project.main_group.new_reference(path)
  app.frameworks_build_phase.add_file_reference(reference, true)
  build = embed.add_file_reference(reference, true)
  build.settings = { 'ATTRIBUTES' => ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] }
end
project.save
