import { SetMetadata } from '@nestjs/common';
export const PLATFORM_PERMISSION_KEY = 'platform_permission';
export const PLATFORM_OWNER_ONLY_KEY = 'platform_owner_only';
export const RequirePlatformPermission = (permission: string) => SetMetadata(PLATFORM_PERMISSION_KEY, permission);
export const RequirePlatformOwner = () => SetMetadata(PLATFORM_OWNER_ONLY_KEY, true);
