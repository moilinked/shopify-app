// save as fetch-admin-schema.mjs
import { getIntrospectionQuery, buildClientSchema, printSchema } from 'graphql';
import fetch from 'node-fetch';
import fs from 'fs';

const SHOP = 'siliconnova.myshopify.com';
const API_VERSION = '2026-01';
const ACCESS_TOKEN = 'shpua_388e8f86200e9f678b61877d0a13d819';

const endpoint = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

async function fetchSchema() {
  const introspectionQuery = getIntrospectionQuery();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ACCESS_TOKEN,
    },
    body: JSON.stringify({ query: introspectionQuery }),
  });

  const result = await response.json();

  if (result.errors) {
    console.error('Errors:', result.errors);
    return;
  }

  // 1) 保存 JSON introspection
  fs.writeFileSync(
    'admin-schema.json',
    JSON.stringify(result.data, null, 2),
    'utf8',
  );

  // 2) 转成 SDL（.graphql）格式
  const schema = buildClientSchema(result.data);
  const sdl = printSchema(schema);
  fs.writeFileSync('admin-schema.graphql', sdl, 'utf8');

  console.log('Schema saved as admin-schema.json and admin-schema.graphql');
}

fetchSchema().catch(console.error);