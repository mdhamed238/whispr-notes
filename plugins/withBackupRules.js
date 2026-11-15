/**
 * Android backup rules.
 *
 * Auto Backup stores at most 25 MB per app in the cloud, and when an app's
 * files exceed that, nothing is backed up at all. WhisprNotes keeps hundreds
 * of megabytes of AI models and recordings next to a small notes database,
 * so without rules the notes themselves were never backed up.
 *
 *  - AI models can be downloaded again: excluded everywhere.
 *  - Recordings are too large for the cloud quota: excluded from cloud
 *    backup, but still copied in a device-to-device transfer (no size limit).
 *  - The notes database, timelines and settings are backed up as usual.
 *
 * Paths are relative to the app's files directory, which is where
 * expo-file-system's document directory lives. iOS is handled at runtime
 * (services/ai/modelManager.ts excludes the model folders from iCloud).
 */
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const REDOWNLOADABLE = ['models', 'react-native-executorch'];
const TOO_LARGE_FOR_CLOUD = ['audio'];

const excludes = (paths, indent) =>
  paths.map((p) => `${indent}<exclude domain="file" path="${p}"/>`).join('\n');

/** Android 12+ (API 31): separate rules for cloud backup and device transfer. */
const dataExtractionRules = () => `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${excludes([...REDOWNLOADABLE, ...TOO_LARGE_FOR_CLOUD], '    ')}
  </cloud-backup>
  <device-transfer>
${excludes(REDOWNLOADABLE, '    ')}
  </device-transfer>
</data-extraction-rules>
`;

/** Android 11 and older: one rule set for everything. */
const fullBackupContent = () => `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${excludes([...REDOWNLOADABLE, ...TOO_LARGE_FOR_CLOUD], '  ')}
</full-backup-content>
`;

module.exports = function withBackupRules(config) {
  config = withDangerousMod(config, [
    'android',
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'whisprnotes_data_extraction_rules.xml'), dataExtractionRules());
      fs.writeFileSync(path.join(dir, 'whisprnotes_full_backup_content.xml'), fullBackupContent());
      return cfg;
    },
  ]);

  return withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    application.$['android:dataExtractionRules'] = '@xml/whisprnotes_data_extraction_rules';
    application.$['android:fullBackupContent'] = '@xml/whisprnotes_full_backup_content';
    return cfg;
  });
};

module.exports.dataExtractionRules = dataExtractionRules;
module.exports.fullBackupContent = fullBackupContent;
