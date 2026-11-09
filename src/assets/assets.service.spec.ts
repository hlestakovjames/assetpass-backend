import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AssetsService, type CreateAssetRegistrationInput } from './assets.service';

describe('AssetsService registration validation', () => {
  const service = new AssetsService({} as DataSource);
  const validate = Reflect.get(service, 'validateInput') as (input: CreateAssetRegistrationInput) => {
    name: string; condition: string; ownershipBasis: string; currencyCode: string | null;
    evidence: Array<{ evidenceType: string; objectReference: string }>;
  };

  const validInput = (): CreateAssetRegistrationInput => ({
    name: 'Laptop',
    condition: 'Good',
    ownershipBasis: 'purchase',
    evidence: [{ evidenceType: 'proof_of_ownership', objectReference: 'private/assets/evidence-123' }],
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
      evidence: [{ evidenceType: 'asset_photo', objectReference: 'private/assets/photo-1' }],
    })).toThrow(BadRequestException);
  });

  it('rejects public URLs as evidence object references', () => {
    expect(() => validate({
      ...validInput(),
      evidence: [{ evidenceType: 'proof_of_ownership', objectReference: 'https://example.com/receipt.pdf' }],
    })).toThrow(BadRequestException);
  });

  it('rejects impossible acquisition dates', () => {
    expect(() => validate({ ...validInput(), acquisitionDate: '2026-02-31' })).toThrow(BadRequestException);
  });

  it('requires at least one evidence item', () => {
    expect(() => validate({ ...validInput(), evidence: [] })).toThrow(BadRequestException);
  });
});
