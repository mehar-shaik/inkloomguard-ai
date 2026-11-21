import React, { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import type { AuthUser } from '../types';
import { getUserInitials } from '../utils/roles';
import { ProtectedImage } from './ClayUI';

export function UserAvatar({
  user,
  size = 'md',
  className = '',
}: {
  user: Pick<AuthUser, 'name' | 'email' | 'avatarFilename' | 'avatarUrl'>;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [user.avatarFilename, user.avatarUrl]);

  const sizeClasses =
    size === 'sm'
      ? 'w-9 h-9 text-xs rounded-full'
      : size === 'lg'
        ? 'w-16 h-16 text-xl rounded-2xl'
        : 'w-11 h-11 text-sm rounded-2xl';

  const initials = getUserInitials(user.name, user.email);

  const fallbackAvatar = (
    <div
      aria-hidden="true"
      className={`${sizeClasses} shrink-0 flex items-center justify-center font-extrabold tracking-tight text-white shadow-sm border border-white/80 dark:border-violet-300/30 select-none ${className}`}
      style={{
        background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 58%, #06B6D4 100%)',
      }}
    >
      {initials || <User className="w-4 h-4" />}
    </div>
  );

  if (user.avatarFilename) {
    return (
      <ProtectedImage
        filename={user.avatarFilename}
        alt={user.name || 'User avatar'}
        className={`${sizeClasses} shrink-0 object-cover border border-white/80 dark:border-violet-400/35 shadow-xs ${className}`}
        fallback={fallbackAvatar}
      />
    );
  }

  if (user.avatarUrl && !imgFailed) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.name || 'User avatar'}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`${sizeClasses} shrink-0 object-cover border border-white/80 dark:border-violet-400/35 shadow-xs ${className}`}
      />
    );
  }

  return fallbackAvatar;
}
