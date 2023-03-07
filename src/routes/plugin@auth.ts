import { serverAuth$ } from '@builder.io/qwik-auth';
import GitHub from '@auth/core/providers/github';
import type { Provider } from '@auth/core/providers';

export const { onRequest, useAuthSession, useAuthSignin, useAuthSignout } = serverAuth$(() => ({
  secret: 'AUTH_SECRET',
  trustHost: true,
  providers: [
    GitHub({
      clientId: 'GITHUB_ID',
      clientSecret: 'GITHUB_SECRET',
    }),
  ] as Provider[],
}));
