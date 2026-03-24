curl -X POST \
  https://your-store.myshopify.com/admin/api/2024-01/graphql.json \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Access-Token: YOUR_ADMIN_API_ACCESS_TOKEN" \
  -d '{
    "query": "query IntrospectionQuery { __schema { types { name kind } } }"
  }' \
  > admin-schema-partial.json