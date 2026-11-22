import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EvidenceStorageService } from './evidence-storage.service';

describe('EvidenceStorageService file signature checks', () => {
  const service = new EvidenceStorageService({} as ConfigService, {} as DataSource);
  const matches = Reflect.get(service, 'matchesFileSignature') as (contentType: string, sample: Buffer) => boolean;

  it('recognizes supported PDF and image signatures', () => {
    expect(matches('application/pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    expect(matches('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(matches('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(matches('image/webp', Buffer.from('RIFF0000WEBP'))).toBe(true);
  });

  it('rejects mismatched and unsupported file signatures', () => {
    expect(matches('application/pdf', Buffer.from('not a PDF'))).toBe(false);
    expect(matches('image/png', Buffer.from('%PDF-1.7'))).toBe(false);
    expect(matches('application/zip', Buffer.from('PK'))).toBe(false);
  });
});
