import { Auth, skipCSRFCheck } from '@auth/core';
import type { AuthAction, AuthConfig, Session } from '@auth/core/types';
import { implicit$FirstArg, QRL } from '@builder.io/qwik';
import { action$, loader$, RequestEvent, RequestEventCommon, z, zod$ } from '@builder.io/qwik-city';
import { isServer } from '@builder.io/qwik/build';
import { parseString, splitCookiesString } from 'set-cookie-parser';

export interface QwikAuthConfig extends AuthConfig {}

const actions: AuthAction[] = [
  'providers',
  'session',
  'csrf',
  'signin',
  'signout',
  'callback',
  'verify-request',
  'error',
];

export async function authAction(
  body: URLSearchParams | undefined,
  req: RequestEventCommon,
  path: string,
  authOptions: QwikAuthConfig
) {
  const request = new Request(new URL(path, req.request.url), {
    method: req.request.method,
    headers: req.request.headers,
    body: body,
  });
  request.headers.set('content-type', 'application/x-www-form-urlencoded');
  const res = await Auth(request, {
    ...authOptions,
    skipCSRFCheck,
  });
  res.headers.forEach((value, key) => {
    req.headers.set(key, value);
  });
  fixCookies(req);

  try {
    return await res.json();
  } catch (error) {
    return await res.text();
  }
}

export const fixCookies = (req: RequestEventCommon) => {
  req.headers.set('set-cookie', req.headers.get('set-cookie') || '');
  const cookie = req.headers.get('set-cookie');
  if (cookie) {
    req.headers.delete('set-cookie');
    splitCookiesString(cookie).forEach((cookie) => {
      const { name, value, ...rest } = parseString(cookie);
      req.cookie.set(name, value, rest as any);
    });
  }
};

export const getCurrentPageForAction = (req: RequestEventCommon) => req.url.href.split('/q-')[0];

export function serverAuthQrl(authOptions: QRL<(ev: RequestEventCommon) => QwikAuthConfig>) {
  const useAuthSignin = action$(
    async ({ providerId, callbackUrl, ...rest }, req) => {
      callbackUrl ??= getCurrentPageForAction(req);
      const auth = await authOptions(req);
      const body = new URLSearchParams({ callbackUrl });
      Object.entries(rest).forEach(([key, value]) => {
        body.set(key, String(value));
      });
      const pathname = '/api/auth/signin' + (providerId ? `/${providerId}` : '');
      const data = await authAction(body, req, pathname, auth);
      if (data.url) {
        throw req.redirect(301, data.url);
      }
    },
    zod$({
      providerId: z.string().optional(),
      callbackUrl: z.string().optional(),
    })
  );

  const useAuthSignout = action$(
    async ({ callbackUrl }, req) => {
      callbackUrl ??= getCurrentPageForAction(req);
      const auth = await authOptions(req);
      const body = new URLSearchParams({ callbackUrl });
      await authAction(body, req, `/api/auth/signout`, auth);
    },
    zod$({
      callbackUrl: z.string().optional(),
    })
  );

  const useAuthSession = loader$((req) => {
    return req.sharedMap.get('session') as Session | null;
  });

  const onRequest = async (req: RequestEvent) => {
    if (isServer) {
      const prefix: string = '/api/auth';

      const action = req.url.pathname.slice(prefix.length + 1).split('/')[0] as AuthAction;

      const auth = await authOptions(req);
      if (actions.includes(action) && req.url.pathname.startsWith(prefix + '/')) {
        const res = await Auth(req.request, auth);
        const cookie = res.headers.get('set-cookie');
        if (cookie) {
          req.headers.set('set-cookie', cookie);
          res.headers.delete('set-cookie');
          fixCookies(req);
        }
        throw req.send(res);
      } else {
        req.sharedMap.set('session', await getSessionData(req.request, auth));
      }
    }
  };

  return {
    useAuthSignin,
    useAuthSignout,
    useAuthSession,
    onRequest,
  };
}

export const serverAuth$ = /*#__PURE__*/ implicit$FirstArg(serverAuthQrl);

export const ensureAuthMiddleware = (req: RequestEvent) => {
  const isLoggedIn = req.sharedMap.has('session');
  if (!isLoggedIn) {
    throw req.error(403, 'sfs');
  }
};

export type GetSessionResult = Promise<Session | null>;

export async function getSessionData(req: Request, options: AuthConfig): GetSessionResult {
  options.secret ??= process.env.AUTH_SECRET;
  options.trustHost ??= true;

  const url = new URL('/api/auth/session', req.url);
  const response = await Auth(new Request(url, { headers: req.headers }), options);

  const { status = 200 } = response;

  const data = await response.json();
  if (!data || !Object.keys(data).length) return null;
  if (status === 200) return data;
  throw new Error(data.message);
}
