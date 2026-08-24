import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

/*
 * Guest action guard.
 * Returns a function that wraps any write action; when the current
 * session is a guest, the action is blocked with a clear message
 * instead of firing a doomed request.
 */
export const useGuestGuard = () => {
  const { isGuest } = useAuth();
  const { toast } = useToast();

  return useCallback(
    (action) => {
      if (isGuest) {
        toast.warning('This action is unavailable in Guest Mode. Sign in with a pharmacy account to make changes.');
        return false;
      }
      if (typeof action === 'function') action();
      return true;
    },
    [isGuest, toast]
  );
};
