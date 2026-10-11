import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Community features need an identity: no session → straight to /auth.
 * The check is instant (token presence + cached user); a token that died
 * server-side gets cleaned up by the API client's 401 handler.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isLoggedIn) return true;
  return router.createUrlTree(['/auth']);
};
