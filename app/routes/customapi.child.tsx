import { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { authenticate } from '../shopify.server'

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request)
  return {}
}

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log('触发 child')
  const url = new URL(request.url)
  const hmac = url.searchParams.toString()
  const result = await fetch('http://localhost:9998/app/ping', {
    headers: { 'Content-Type': 'application/json', hmac },
  })
  const data = await result.json()
  console.log('data ============================= ', data)
  return { message: 'ok' }
}
