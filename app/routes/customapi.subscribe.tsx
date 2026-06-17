import { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { authenticate } from '../shopify.server'

const MAX_TAG_COUNT = 3
const MAX_TAG_LENGTH = 50
const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SUBSCRIBE_SUCCESS_RESPONSE: SubscribeResult = { success: true }

type AdminClient = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>
    },
  ) => Promise<{
    json: <T>() => Promise<GraphqlResponse<T>>
  }>
}

type CustomerUserError = {
  field?: string[] | null
  message: string
}

type GraphqlResponse<T> = {
  data?: T
}

type CustomerEmailAddress = {
  emailAddress?: string | null
  marketingState?: string | null
  marketingOptInLevel?: string | null
}

type SubscribeCustomer = {
  id: string
  tags?: string[] | null
  defaultEmailAddress?: CustomerEmailAddress | null
}

type CustomersByEmailData = {
  customers?: {
    edges?: Array<{
      node?: SubscribeCustomer | null
    }>
  }
}

type CustomerCreateResult = {
  customerCreate?: {
    customer?: SubscribeCustomer | null
    userErrors?: CustomerUserError[]
  }
}

type CustomerUpdateResult = {
  customerUpdate?: {
    customer?: SubscribeCustomer | null
    userErrors?: CustomerUserError[]
  }
}

type EmailConsentResult = {
  customerEmailMarketingConsentUpdate?: {
    customer?: {
      defaultEmailAddress?: CustomerEmailAddress | null
    } | null
    userErrors?: CustomerUserError[]
  }
}

type SubscribeResult = {
  success: boolean
}

class BusinessError extends Error {
  code: number

  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

function jsonOk<T>(data: T, message = 'ok') {
  return new Response(JSON.stringify({ code: 200, message, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function jsonFail(code: number, message: string) {
  return new Response(JSON.stringify({ code, message }), {
    status: code,
    headers: { 'Content-Type': 'application/json' },
  })
}

function withCors(response: Response) {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }))
  }
  await authenticate.public.appProxy(request)
  return withCors(jsonFail(405, 'Method Not Allowed'))
}

//- 解析逗号分隔的 tags 字符串，最多保留 3 个有效 tag。
function parseTags(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  const tags: string[] = []
  for (const tag of raw.split(',')) {
    const trimmed = tag.trim()
    if (!trimmed || trimmed.length > MAX_TAG_LENGTH || tags.includes(trimmed)) continue
    tags.push(trimmed)
    if (tags.length >= MAX_TAG_COUNT) break
  }
  return tags
}

function isValidEmail(email: string): boolean {
  return BASIC_EMAIL_PATTERN.test(email)
}

function throwIfUserErrors(errors: CustomerUserError[] | undefined, label: string) {
  if (errors?.length) {
    throw new BusinessError(422, `[${label}] ${errors[0].message}`)
  }
}

async function getCustomerByEmail(admin: AdminClient, email: string): Promise<SubscribeCustomer | null> {
  const customerRequest = await admin.graphql(CustomerByEmailGQL, {
    variables: { query: `email:${JSON.stringify(email)}` },
  })
  const customerReqJson = await customerRequest.json<CustomersByEmailData>()
  return customerReqJson.data?.customers?.edges?.[0]?.node ?? null
}

async function createCustomer(admin: AdminClient, data: { email: string; tags: string[] }): Promise<SubscribeCustomer> {
  const input: Record<string, unknown> = {
    email: data.email,
    emailMarketingConsent: {
      marketingState: 'SUBSCRIBED',
      marketingOptInLevel: 'SINGLE_OPT_IN',
    },
  }
  if (data.tags.length) input.tags = data.tags

  const createCustomerRequest = await admin.graphql(CustomerCreateGQL, { variables: { input } })
  const createCustomerReqJson = await createCustomerRequest.json<CustomerCreateResult>()
  throwIfUserErrors(createCustomerReqJson.data?.customerCreate?.userErrors, 'CREATE_FAILED')

  const customer = createCustomerReqJson.data?.customerCreate?.customer
  if (!customer) {
    throw new BusinessError(500, '[CREATE_FAILED] Customer was not created')
  }
  return customer
}

async function updateCustomer(
  admin: AdminClient,
  existing: SubscribeCustomer,
  data: { tags: string[] },
): Promise<SubscribeCustomer> {
  const mergedTags = Array.from(new Set([...(existing.tags ?? []), ...data.tags]))

  const updateCustomerRequest = await admin.graphql(CustomerUpdateGQL, {
    variables: { input: { id: existing.id, tags: mergedTags } },
  })
  const updateCustomerReqJson = await updateCustomerRequest.json<CustomerUpdateResult>()
  throwIfUserErrors(updateCustomerReqJson.data?.customerUpdate?.userErrors, 'UPDATE_FAILED')

  let customer: SubscribeCustomer = updateCustomerReqJson.data?.customerUpdate?.customer ?? existing

  const consent = await updateEmailConsent(admin, existing.id)
  if (consent) {
    customer = { ...customer, defaultEmailAddress: { ...customer.defaultEmailAddress, ...consent } }
  }

  return customer
}

async function updateEmailConsent(admin: AdminClient, customerId: string) {
  const emailConsentRequest = await admin.graphql(CustomerEmailConsentGQL, {
    variables: {
      input: {
        customerId,
        emailMarketingConsent: {
          marketingState: 'SUBSCRIBED',
          marketingOptInLevel: 'SINGLE_OPT_IN',
        },
      },
    },
  })
  const emailConsentReqJson = await emailConsentRequest.json<EmailConsentResult>()
  throwIfUserErrors(emailConsentReqJson.data?.customerEmailMarketingConsentUpdate?.userErrors, 'EMAIL_CONSENT_FAILED')
  return emailConsentReqJson.data?.customerEmailMarketingConsentUpdate?.customer?.defaultEmailAddress
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { admin } = (await authenticate.public.appProxy(request)) ?? {}

    if (!admin) {
      return withCors(jsonFail(401, 'Failed to authenticate with Shopify'))
    }

    const formData = await request.formData()
    const email = String(formData.get('email') ?? '').trim()
    const tags = parseTags(formData.get('tags'))

    //- 表单校验
    if (!email) {
      return withCors(jsonFail(400, 'Email is required'))
    }
    if (!isValidEmail(email)) {
      return withCors(jsonFail(400, 'Invalid email format'))
    }

    //- 根据 email 判断当前客户是否存在
    const existing = await getCustomerByEmail(admin, email)

    if (!existing) {
      //- 新建客户并订阅邮件
      await createCustomer(admin, { email, tags })
      return withCors(jsonOk<SubscribeResult>(SUBSCRIBE_SUCCESS_RESPONSE, 'Subscribed successfully'))
    }

    //- 更新客户 tag，并同步邮件订阅状态
    await updateCustomer(admin, existing, { tags })
    return withCors(jsonOk<SubscribeResult>(SUBSCRIBE_SUCCESS_RESPONSE, 'Subscribed successfully'))
  } catch (error) {
    const code = error instanceof BusinessError ? error.code : 400
    return withCors(jsonFail(code, error instanceof Error ? error.message : 'Failed to subscribe'))
  }
}

//* 查找
const CustomerByEmailGQL = `#graphql
query customerByEmail($query: String!) {
  customers(first: 1, query: $query) {
    edges {
      node {
        id
        tags
        defaultEmailAddress {
          emailAddress
          marketingState
          marketingOptInLevel
        }
      }
    }
  }
}`

//* 创建
const CustomerCreateGQL = `#graphql
mutation customerCreate($input: CustomerInput!) {
  customerCreate(input: $input) {
    customer {
      id
      tags
      defaultEmailAddress {
        emailAddress
        marketingState
        marketingOptInLevel
      }
    }
    userErrors {
      field
      message
    }
  }
}`

//* 更新
const CustomerUpdateGQL = `#graphql
mutation customerUpdate($input: CustomerInput!) {
  customerUpdate(input: $input) {
    customer {
      id
      tags
      defaultEmailAddress {
        emailAddress
      }
    }
    userErrors {
      field
      message
    }
  }
}`

//* 更新 Email 订阅状态
const CustomerEmailConsentGQL = `#graphql
mutation customerEmailMarketingConsentUpdate($input: CustomerEmailMarketingConsentUpdateInput!) {
  customerEmailMarketingConsentUpdate(input: $input) {
    customer {
      id
      defaultEmailAddress {
        marketingState
        marketingOptInLevel
      }
    }
    userErrors {
      field
      message
    }
  }
}`
