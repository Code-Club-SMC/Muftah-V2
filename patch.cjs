const fs = require('fs');
const path = 'src/routes/_protected/operator/index.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace('<TabsTrigger value="legacy">Legacy Production</TabsTrigger>', '');

const contentRegex = /<TabsContent value="legacy">[\s\S]*?<\/TabsContent>/;
code = code.replace(contentRegex, '');

code = code.replace('import { getProductionRunsFn } from "@/server-functions/inventory/production/get-production-run-fn";\n', '');
code = code.replace('import { OperatorInterface } from "@/components/operator/operator-interface";\n', '');

const queryRegex = /void context\.queryClient\.prefetchQuery\(\{\s*queryKey: \["operator-production-runs"\],\s*queryFn: \(\) => getProductionRunsFn\(\{ data: \{ filter: "active" \} \}\),\s*\}\);\s*/;
code = code.replace(queryRegex, '');

fs.writeFileSync(path, code);
