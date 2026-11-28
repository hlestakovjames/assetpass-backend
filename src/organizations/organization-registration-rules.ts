import { BadRequestException } from '@nestjs/common';

export const ORGANIZATION_REGISTRATION_RULES_VERSION = '2026-11-28.v1';

export const ORGANIZATION_TYPE_KEYS = [
  'Company',
  'Non-governmental organization (NGO)',
  'Non-profit organization',
  'Government institution',
  'Educational institution',
  'Healthcare institution',
  'Religious institution',
  'Cooperative',
  'Partnership',
  'Sole proprietorship',
  'Community-based organization',
  'Trust or foundation',
  'Other',
] as const;

export type OrganizationTypeKey = (typeof ORGANIZATION_TYPE_KEYS)[number];

export const ORGANIZATION_REGISTRATION_STATUSES = [
  'registered',
  'established_by_law',
  'provisional',
  'informal',
  'emerging',
  'not_registered',
] as const;

export type OrganizationRegistrationStatus =
  (typeof ORGANIZATION_REGISTRATION_STATUSES)[number];

const TYPE_ALIASES: Record<string, OrganizationTypeKey> = {
  NGO: 'Non-governmental organization (NGO)',
  'Non-profit': 'Non-profit organization',
  'Government': 'Government institution',
  'School': 'Educational institution',
  'Hospital': 'Healthcare institution',
  'Religious organization': 'Religious institution',
  'CBO': 'Community-based organization',
  'Trust': 'Trust or foundation',
};

export function normalizeOrganizationType(value: string): OrganizationTypeKey | null {
  const normalized = value.trim();
  if ((ORGANIZATION_TYPE_KEYS as readonly string[]).includes(normalized)) {
    return normalized as OrganizationTypeKey;
  }
  return TYPE_ALIASES[normalized] ?? null;
}

export function validateOrganizationRegistrationDetails(input: {
  organizationType: string;
  registrationStatus?: string;
  legalStructure?: string;
  registrationNumber?: string;
  registrationAuthority?: string;
  establishmentReference?: string;
  description?: string;
  organizationSubtype?: string;
}) {
  const organizationType = normalizeOrganizationType(input.organizationType);
  if (!organizationType) {
    throw new BadRequestException('Select a supported organisation type.');
  }

  const registrationStatus = input.registrationStatus?.trim() ?? '';
  if (!(ORGANIZATION_REGISTRATION_STATUSES as readonly string[]).includes(registrationStatus)) {
    throw new BadRequestException('Select the organisation registration or establishment status.');
  }

  const registrationNumber = input.registrationNumber?.trim() ?? '';
  const registrationAuthority = input.registrationAuthority?.trim() ?? '';
  const establishmentReference = input.establishmentReference?.trim() ?? '';
  const legalStructure = input.legalStructure?.trim() ?? '';

  if (registrationStatus === 'registered') {
    if (!registrationNumber || !registrationAuthority) {
      throw new BadRequestException('For a registered organisation, provide its registration number and registration authority.');
    }
    if (
      ['Company', 'Partnership', 'Sole proprietorship', 'Cooperative'].includes(organizationType) &&
      !legalStructure
    ) {
      throw new BadRequestException('Select the legal structure for this registered organisation.');
    }
  }

  if (registrationStatus === 'established_by_law') {
    if (organizationType !== 'Government institution') {
      throw new BadRequestException('Established by law is available only for government or public institutions.');
    }
    if (!establishmentReference) {
      throw new BadRequestException('Provide the establishing law, gazette notice, order or official reference.');
    }
  }

  if (['Educational institution', 'Healthcare institution'].includes(organizationType) && !input.organizationSubtype?.trim()) {
    throw new BadRequestException('Select the institution or facility subtype for this organisation type.');
  }

  if (organizationType === 'Government institution' && !['registered', 'established_by_law'].includes(registrationStatus)) {
    throw new BadRequestException('A government or public institution must provide its registration details or an establishing-law reference.');
  }

  if (organizationType === 'Other' && !input.description?.trim()) {
    throw new BadRequestException('Describe the organisation when selecting Other.');
  }

  return {
    organizationType,
    registrationStatus: registrationStatus as OrganizationRegistrationStatus,
    legalStructure: legalStructure || null,
    registrationNumber: registrationNumber || null,
    registrationAuthority: registrationAuthority || null,
    establishmentReference: establishmentReference || null,
    rulesVersion: ORGANIZATION_REGISTRATION_RULES_VERSION,
  };
}
