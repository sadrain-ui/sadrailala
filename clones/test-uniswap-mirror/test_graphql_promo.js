const http = require('http');
const data = JSON.stringify({
  "operationName": "TokensPromo",
  "variables": {
    "contracts": [{"chain": "SOLANA"}, {"chain": "ETHEREUM"}]
  },
  "query": "query TokensPromo($contracts: [ContractInput!]!) { tokens(contracts: $contracts) { id name symbol market { price { value } } } }"
});

const req = http.request('http://localhost:8080/__legion_proxy/interface.gateway.uniswap.org/v1/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': 'https://app.uniswap.org',
    'Content-Length': Buffer.byteLength(data)
  }
}, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log('HTTP:', res.statusCode, 'RES:', body.substring(0, 500)));
});
req.write(data);
req.end();
