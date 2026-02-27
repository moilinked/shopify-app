import { useMemo } from 'react'
import { useMatches } from 'react-router'
import createApp from '@shopify/app-bridge'
import { getSessionToken } from '@shopify/app-bridge/utilities'

async function authFetch(
  apiKey: string,
  host: string,
  url: string,
  method: 'GET' | 'POST',
  data?: Record<string, string> | Record<string, unknown>,
) {
  const app = createApp({ apiKey, host })
  const token = await getSessionToken(app)

  let finalUrl = url
  if (method === 'GET' && data) {
    const params = new URLSearchParams(data as Record<string, string>)
    finalUrl = `${url}?${params.toString()}`
  }

  return fetch(finalUrl, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(method === 'POST' && data ? { body: JSON.stringify(data) } : {}),
  })
}

export function useAuthFetch() {
  const matches = useMatches()
  const appMatch = matches.find(
    m =>
      m.loaderData &&
      typeof m.loaderData === 'object' &&
      'apiKey' in m.loaderData &&
      'host' in m.loaderData,
  )

  const { apiKey, host } = (appMatch?.loaderData ?? {
    apiKey: '',
    host: '',
  }) as { apiKey: string; host: string }

  return useMemo(
    () => ({
      get: (url: string, query?: Record<string, string>) =>
        authFetch(apiKey, host, url, 'GET', query),
      post: (url: string, body?: Record<string, unknown>) =>
        authFetch(apiKey, host, url, 'POST', body),
    }),
    [apiKey, host],
  )
}
