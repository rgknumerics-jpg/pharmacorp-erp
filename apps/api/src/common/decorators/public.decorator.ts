import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';

/** Marque une route comme accessible sans authentification (ex: /auth/login, /health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
