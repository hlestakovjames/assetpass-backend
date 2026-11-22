import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AssetsService, type CreateAssetRegistrationInput } from './assets.service';

describe('AssetsService registration validation', () => {
  const service = new AssetsService({} as DataSource);
  const validate = Reflect.get(service, 'validateInput') as (input: CreateAssetRegistrationInput) => {
    name: string; condition: string; ownershipBasis: string; currencyCode: string | null;
    evidence: Array<{ evidenceType: string; uploadId: string }>;
  };

  const validInput = (): CreateAssetRegistrationInput => ({
    name: 'Laptop',
    condition: 'Good',
    ownershipBasis: 'purchase',
    evidence: [{ evidenceType: 'proof_of_ownership', uploadId: '6a582525-5154-4944-8940-000000000001' }],
  });

  it('normalizes a valid registration payload', () => {
    const result = validate({ ...validInput(), currencyCode: 'kes' });
    expect(result.name).toBe('Laptop');
    expect(result.condition).toBe('good');
    expect(result.ownershipBasis).toBe('purchase');
    expect(result.currencyCode).toBe('KES');
  });

  it('requires evidence of ownership or a purchase receipt', () => {
    expect(() => validate({
      ...validInput(),
      evidence: [{ evidenceType: 'asset_photo', uploadId: '6a582525-5154-4944-8940-000000000001' }],
    })).toThrow(BadRequestException);
  });

  it('rejects arbitrary object references that are not upload IDs', () => {
    expect(() => validate({
      ...validInput(),
      evidence: [{ evidenceType: 'proof_of_ownership', uploadId: 'https://example.com/receipt.pdf' }],
    })).toThrow(BadRequestException);
  });

  it('rejects impossible acquisition dates', () => {
    expect(() => validate({ ...validInput(), acquisitionDate: '2026-02-31' })).toThrow(BadRequestException);
  });

  it('requires at least one evidence item', () => {
    expect(() => validate({ ...validInput(), evidence: [] })).toThrow(BadRequestException);
  });
});
