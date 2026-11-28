import { BadRequestException } from '@nestjs/common';
import {
  ORGANIZATION_REGISTRATION_RULES_VERSION,
  normalizeOrganizationType,
  validateOrganizationRegistrationDetails,
} from './organization-registration-rules';

describe('organization registration rules', () => {
  it('normalizes supported legacy organization type aliases', () => {
    expect(normalizeOrganizationType('NGO')).toBe('Non-governmental organization (NGO)');
    expect(normalizeOrganizationType('CBO')).toBe('Community-based organization');
  });

  it('requires a supported type and registration status', () => {
    expect(() => validateOrganizationRegistrationDetails({
      organizationType: 'Unrecognised type',
      registrationStatus: 'registered',
    })).toThrow(BadRequestException);

    expect(() => validateOrganizationRegistrationDetails({
      organizationType: 'Company',
      registrationStatus: 'unknown',
    })).toThrow(BadRequestException);
  });

  it('requires registry details and legal structure for a registered company', () => {
    expect(() => validateOrganizationRegistrationDetails({
      organizationType: 'Company',
      registrationStatus: 'registered',
      registrationNumber: 'CPR/123',
      registrationAuthority: 'Business Registration Service',
    })).toThrow('Select the legal structure');

    expect(() => validateOrganizationRegistrationDetails({
      organizationType: 'Company',
      registrationStatus: 'registered',
      legalStructure: 'Private limited company',
      registrationNumber: 'CPR/123',
      registrationAuthority: 'Business Registration Service',
    })).not.toThrow();
  });

  it('supports informal and emerging organisations without forcing company registry details', () => {
    for (const registrationStatus of ['informal', 'emerging', 'provisional', 'not_registered']) {
      expect(() => validateOrganizationRegistrationDetails({
        organizationType: 'Community-based organization',
        registrationStatus,
      })).not.toThrow();
    }
  });

  it('requires a subtype for education and healthcare institutions', () => {
    expect(() => validateOrganizationRegistrationDetails({
      organizationType: 'Educational institution',
      registrationStatus: 'not_registered',
    })).toThrow('institution or facility subtype');

    expect(() => validateOrganizationRegistrationDetails({
      organizationType: 'Healthcare institution',
      registrationStatus: 'registered',
      registrationNumber: 'HF/123',
      registrationAuthority: 'Health regulator',
    })).toThrow('institution or facility subtype');

    expect(() => validateOrganizationRegistrationDetails({
      organizationType: 'Educational institution',
      registrationStatus: 'not_registered',
      organizationSubtype: 'University',
    })).not.toThrow();
  });

  it('limits established-by-law status to public institutions and requires its reference', () => {
    expect(() => validateOrganizationRegistrationDetails({
      organizationType: 'Government institution',
      registrationStatus: 'established_by_law',
    })).toThrow('establishing law');

    expect(() => validateOrganizationRegistrationDetails({
      organizationType: 'Company',
      registrationStatus: 'established_by_law',
      establishmentReference: 'Act No. 2 of 2020',
    })).toThrow('only for government');
  });

  it('requires an explanation for the Other classification and records the rules version', () => {
    expect(() => validateOrganizationRegistrationDetails({
      organizationType: 'Other',
      registrationStatus: 'not_registered',
    })).toThrow('Describe the organisation');

    const result = validateOrganizationRegistrationDetails({
      organizationType: 'Other',
      registrationStatus: 'not_registered',
      description: 'An emerging member association',
    });
    expect(result.rulesVersion).toBe(ORGANIZATION_REGISTRATION_RULES_VERSION);
  });
});
