import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { OrganizationMembership, OrganizationMembershipStatus } from '../organizations/entities/organization-membership.entity';
import { AssetEvidenceUpload, AssetEvidenceUploadStatus } from './entities/asset-evidence-upload.entity';

type UploadRequest = { fileName: string; contentType: string; sizeBytes: number };
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE_BYTES = 15 * 1024 * 1024;

@Injectable()
export class EvidenceStorageService {
  constructor(private readonly config: ConfigService, private readonly dataSource: DataSource) {}

  async createUpload(userId: string, input: UploadRequest, organizationId: string | null = null) {
    const storage = this.storageConfig();
    if (!input || typeof input.fileName !== 'string' || !input.fileName.trim() || input.fileName.length > 255) {
      throw new BadRequestException('Provide a valid evidence file name.');
    }
    if (!ALLOWED_TYPES.has(input.contentType) || !Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_SIZE_BYTES) {
      throw new BadRequestException('Evidence must be a PDF, JPEG, PNG or WebP file no larger than 15 MB.');
    }
    if (organizationId) {
      const membership = await this.dataSource.getRepository(OrganizationMembership).findOneBy({
        organizationId, userId, status: OrganizationMembershipStatus.ACTIVE,
      });
      if (!membership) throw new ForbiddenException('An active organization membership is required.');
    }
    const id = randomUUID();
    const objectKey = `evidence/${userId}/${id}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const upload = await this.dataSource.getRepository(AssetEvidenceUpload).save({
      id, ownerUserId: userId, organizationId, objectKey,
      originalFileName: input.fileName.trim(), contentType: input.contentType,
      sizeBytes: input.sizeBytes, status: AssetEvidenceUploadStatus.PENDING,
      expiresAt, uploadedAt: null, attachedAt: null,
    });
    return {
      uploadId: upload.id,
      uploadUrl: this.presign(storage, 'PUT', objectKey, 900),
      method: 'PUT',
      headers: { 'Content-Type': upload.contentType },
      expiresAt,
      maxSizeBytes: MAX_SIZE_BYTES,
    };
  }

  async completeUpload(userId: string, uploadId: string, organizationId: string | null = null) {
    const upload = await this.getOwnedUpload(userId, uploadId, organizationId);
    if (upload.status === AssetEvidenceUploadStatus.UPLOADED || upload.status === AssetEvidenceUploadStatus.ATTACHED) {
      return { uploadId: upload.id, status: upload.status };
    }
    if (upload.status !== AssetEvidenceUploadStatus.PENDING || upload.expiresAt.getTime() <= Date.now()) {
      upload.status = AssetEvidenceUploadStatus.EXPIRED;
      await this.dataSource.getRepository(AssetEvidenceUpload).save(upload);
      throw new BadRequestException('This upload reservation has expired. Start a new upload.');
    }
    const storage = this.storageConfig();
    const response = await fetch(this.objectUrl(storage, upload.objectKey), {
      method: 'HEAD',
      headers: this.signedHeaders(storage, 'HEAD', upload.objectKey),
    });
    if (!response.ok) throw new BadRequestException('The evidence file was not found in private storage. Upload it before completing.');
    const actualSize = Number(response.headers.get('content-length'));
    const actualType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (actualSize !== upload.sizeBytes || actualType !== upload.contentType) {
      throw new BadRequestException('The uploaded file size or content type does not match the upload reservation.');
    }
    upload.status = AssetEvidenceUploadStatus.UPLOADED;
    upload.uploadedAt = new Date();
    await this.dataSource.getRepository(AssetEvidenceUpload).save(upload);
    return { uploadId: upload.id, status: upload.status };
  }

  async createDownloadUrl(userId: string, uploadId: string, organizationId: string | null = null) {
    const upload = await this.dataSource.getRepository(AssetEvidenceUpload).findOneBy({ id: uploadId });
    if (!upload || upload.status !== AssetEvidenceUploadStatus.ATTACHED) throw new NotFoundException('Evidence file not found.');
    if (upload.ownerUserId !== userId) {
      if (!organizationId || upload.organizationId !== organizationId) throw new NotFoundException('Evidence file not found.');
      const membership = await this.dataSource.getRepository(OrganizationMembership).findOneBy({
        organizationId, userId, status: OrganizationMembershipStatus.ACTIVE,
      });
      if (!membership) throw new NotFoundException('Evidence file not found.');
    }
    return { downloadUrl: this.presign(this.storageConfig(), 'GET', upload.objectKey, 300), expiresInSeconds: 300 };
  }

  async getOwnedUpload(userId: string, uploadId: string, organizationId: string | null) {
    const upload = await this.dataSource.getRepository(AssetEvidenceUpload).findOneBy({ id: uploadId, ownerUserId: userId });
    if (!upload || upload.organizationId !== organizationId) throw new NotFoundException('Upload reservation not found.');
    return upload;
  }

  private storageConfig() {
    const endpoint = this.config.get<string>('ASSET_STORAGE_ENDPOINT');
    const region = this.config.get<string>('ASSET_STORAGE_REGION');
    const accessKeyId = this.config.get<string>('ASSET_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('ASSET_STORAGE_SECRET_ACCESS_KEY');
    const bucket = this.config.get<string>('ASSET_EVIDENCE_BUCKET');
    if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) {
      throw new ServiceUnavailableException('Private evidence storage is not configured on this API environment.');
    }
    let parsed: URL;
    try { parsed = new URL(endpoint); } catch { throw new ServiceUnavailableException('Private evidence storage endpoint is invalid.'); }
    if (parsed.protocol !== 'https:' && this.config.get<string>('NODE_ENV') === 'production') {
      throw new ServiceUnavailableException('Private evidence storage must use HTTPS in production.');
    }
    return { endpoint: parsed, region, accessKeyId, secretAccessKey, bucket };
  }

  private objectUrl(storage: ReturnType<EvidenceStorageService['storageConfig']>, key: string) {
    const url = new URL(storage.endpoint.toString());
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${this.awsEncode(storage.bucket)}/${key.split('/').map((part) => this.awsEncode(part)).join('/')}`;
    return url;
  }

  private presign(storage: ReturnType<EvidenceStorageService['storageConfig']>, method: 'PUT' | 'GET', key: string, expires: number) {
    const url = this.objectUrl(storage, key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${storage.region}/s3/aws4_request`;
    const params: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${storage.accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expires),
      'X-Amz-SignedHeaders': 'host',
    };
    const canonicalQuery = Object.keys(params).sort().map((name) => `${this.awsEncode(name)}=${this.awsEncode(params[name])}`).join('&');
    const canonicalRequest = [method, url.pathname, canonicalQuery, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const signature = this.hmac(this.signingKey(storage.secretAccessKey, dateStamp, storage.region), stringToSign, 'hex');
    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  private signedHeaders(storage: ReturnType<EvidenceStorageService['storageConfig']>, method: 'HEAD', key: string) {
    const url = this.objectUrl(storage, key);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = 'UNSIGNED-PAYLOAD';
    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${storage.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const signature = this.hmac(this.signingKey(storage.secretAccessKey, dateStamp, storage.region), stringToSign, 'hex');
    return {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${storage.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  private signingKey(secret: string, date: string, region: string) {
    const dateKey = this.hmac(`AWS4${secret}`, date);
    const regionKey = this.hmac(dateKey, region);
    const serviceKey = this.hmac(regionKey, 's3');
    return this.hmac(serviceKey, 'aws4_request');
  }
  private hmac(key: string | Buffer, value: string, encoding?: 'hex'): Buffer | string {
    const digest = createHmac('sha256', key).update(value).digest();
    return encoding ? digest.toString(encoding) : digest;
  }
  private awsEncode(value: string) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  }
}
