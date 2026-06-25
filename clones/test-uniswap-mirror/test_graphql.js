const http = require('http');
const data = JSON.stringify({
  "operationName": "TokenProjects",
  "variables": {
    "contracts": [{"chain": "ETHEREUM"}]
  },
  "query": "query TokenProjects($contracts: [ContractInput!]!) { tokenProjects(contracts: $contracts) { id tokens { id name symbol decimals project { id logoUrl safetyLevel } market { price { value } } } } }"
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
