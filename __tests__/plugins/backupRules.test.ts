const { dataExtractionRules, fullBackupContent } = require('../../plugins/withBackupRules');

describe('Android backup rules', () => {
  test('models are excluded from cloud backup and from device transfer', () => {
    const xml: string = dataExtractionRules();
    const cloud = xml.slice(xml.indexOf('<cloud-backup>'), xml.indexOf('</cloud-backup>'));
    const transfer = xml.slice(xml.indexOf('<device-transfer>'), xml.indexOf('</device-transfer>'));
    for (const dir of ['models', 'react-native-executorch']) {
      expect(cloud).toContain(`<exclude domain="file" path="${dir}"/>`);
      expect(transfer).toContain(`<exclude domain="file" path="${dir}"/>`);
    }
  });

  test('recordings skip the cloud (25 MB quota) but still move to a new phone', () => {
    const xml: string = dataExtractionRules();
    const cloud = xml.slice(xml.indexOf('<cloud-backup>'), xml.indexOf('</cloud-backup>'));
    const transfer = xml.slice(xml.indexOf('<device-transfer>'), xml.indexOf('</device-transfer>'));
    expect(cloud).toContain('path="audio"');
    expect(transfer).not.toContain('path="audio"');
  });

  test('the notes database is never excluded', () => {
    for (const xml of [dataExtractionRules(), fullBackupContent()] as string[]) {
      expect(xml).not.toMatch(/SQLite|database|timelines/);
    }
  });
});
