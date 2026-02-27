import { LoaderFunctionArgs } from 'react-router'
import { authenticate } from '../shopify.server'

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request)
  return {}
}

export const action = async () => {
  console.log('触发 child')
  return { message: 'ok' }
}
