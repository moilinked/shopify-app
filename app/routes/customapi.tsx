import { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  return {}
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jsonResponse(message: string) {
  return new Response(JSON.stringify({ message }), {
    status: 200,
    headers: { "Content-Type": "application / json", },
  });
}

/**
 * 更新手机用户的sms状态
 * 根据手机号查找用户id -> 更新sms状态
 */
async function updatePhoneCustomerSms(admin: AdminApiContext, phone: string) {
  const customerRequest = await admin.graphql(CustomerGQL, { variables: { identifier: { phoneNumber: phone } } });
  const customerReqJson = await customerRequest.json();
  const customerId = customerReqJson.data?.customer?.id;
  await admin.graphql(CustomerSMSGQL, { variables: { customerId } });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);

  if (!admin) return jsonResponse("authfail");
  const formData = await request.formData();
  //- 表单校验
  if (!formData.has('email')) {
    return jsonResponse('Email must not be null');
  }

  //- 根据 email 判断当前客户是否存在
  const customerRequest = await admin.graphql(CustomerGQL, { variables: { identifier: { emailAddress: formData.get("email") } } });
  const customerReqJson = await customerRequest.json();
  let customerId = customerReqJson.data?.customer?.id;
  if (!customerId) {
    //- 新建客户
    const createCustomerRequest = await admin.graphql(CustomerCreateGQL, {
      variables: {
        input: {
          email: formData.get("email"),
          emailMarketingConsent: {
            marketingState: "SUBSCRIBED",
            marketingOptInLevel: "SINGLE_OPT_IN"
          },
          ...(formData.has("phone") ? {
            phone: formData.get("phone"),
            smsMarketingConsent: {
              marketingState: "SUBSCRIBED",
              marketingOptInLevel: "SINGLE_OPT_IN"
            }
          } : {}),
          ...(formData.has("tags") ? { tag: formData.get("tags")?.toString().split(",") } : { tags: ["newsletter"] })
        },
      }
    });
    const createCustomerReqJson = await createCustomerRequest.json();
    const err = createCustomerReqJson.data.customerCreate?.userErrors?.[0];
    if (createCustomerReqJson.data?.customerCreate?.customer) {
      return jsonResponse("ok")
    } else if (err?.message === "Phone has already been taken") {
      //- 客户手机号被占用
      updatePhoneCustomerSms(admin, formData.get('phone')?.toString() ?? "");
      return jsonResponse("ok");
    }
  } else {
    //- 更新客户，customerUpdate 不能同时更新订阅状态
    //- step 1 更新手机号
    const updateCustomerRequest = await admin.graphql(CustomerUpdateGQL, {
      variables: {
        input: {
          phone: formData.get("phone"),
          id: customerId,
          ...(formData.has("tags") ? { tags: formData.get("tags")?.toString().split(",") } : { tags: ["newsletter"] })
        }
      }
    });
    const updateCustomerReqJson = await updateCustomerRequest.json();
    //! 更新失败，手机号被占用
    const err = updateCustomerReqJson.data.customerUpdate?.userErrors?.[0]
    if (err?.message === "Phone has already been taken") {
      updatePhoneCustomerSms(admin, formData.get('phone')?.toString() ?? "")
      return jsonResponse("ok");
    }

    //! 等待 250ms
    await delay(250);

    //- step 2 更新邮件订阅状态
    await admin.graphql(CustomerEmailGQL, { variables: { customerId } });

    //- step 3 更新sms订阅状态
    await admin.graphql(CustomerSMSGQL, { variables: { customerId } });

    return jsonResponse("ok");
  }
  return jsonResponse("ok");
}

//* 查找
const CustomerGQL = `#graphql
query Customer($identifier: CustomerIdentifierInput!) {
  customer: customerByIdentifier(identifier: $identifier) {
    id
    amountSpent {
      amount
      currencyCode
    }
  }
}`

//* 创建
const CustomerCreateGQL = `#graphql
mutation customerCreate($input: CustomerInput!) {
  customerCreate(input: $input) {
    customer {
      id
    }
    userErrors {
      message
      field
    }
  }
}`

//* 更新
const CustomerUpdateGQL = `#graphql
mutation customerUpdate($input: CustomerInput!) {
  customerUpdate(input: $input) {
    customer {
      id
    }
    userErrors {
      message
      field
    }
  }
}`

//* 更新 SMS 订阅状态
const CustomerSMSGQL = `#graphql
mutation customerSmsMarketingConsentUpdate($customerId: ID!) {
  customerSmsMarketingConsentUpdate(
    input: {customerId: $customerId, smsMarketingConsent: {marketingState: SUBSCRIBED, marketingOptInLevel: SINGLE_OPT_IN}}
  ) {
    userErrors {
      field
      message
    }
    customer {
      id
    }
  }
}`

//* 更新 Email 订阅状态
const CustomerEmailGQL = `#graphql
mutation customerEmailMarketingConsentUpdate($customerId: ID!) {
  customerEmailMarketingConsentUpdate(
    input: {customerId: $customerId, emailMarketingConsent: {marketingState: SUBSCRIBED, marketingOptInLevel: SINGLE_OPT_IN}}
  ) {
    userErrors {
      field
      message
    }
    customer {
      id
    }
  }
}`