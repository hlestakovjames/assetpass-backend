import { SetMetadata } from '@nestjs/common';

export const PLATFORM_PERMISSION_KEY = 'platform_permission';
export const PLATFORM_GLOBAL_ADMIN_ONLY_KEY = 'platform_global_admin_only';

/** Legacy decorator name retained for source compatibility; it now means Global Administrator. */
export const RequireGlobalAdministrator = () =>
  SetMetadata(PLATFORM_GLOBAL_ADMIN_ONLY_KEY, true);
export const RequirePlatformOwner = RequireGlobalAdministrator;
export const RequirePlatformPermission = (permission: string) =>
  SetMetadata(PLATFORM_PERMISSION_KEY, permission);
