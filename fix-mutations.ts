import fs from 'fs';

const mixingPath = '/home/abdul-rehman/Projects/titan-new/src/hooks/manufacturing/mixing/use-mixing-mutations.ts';
let mixingCode = fs.readFileSync(mixingPath, 'utf8');

mixingCode = mixingCode.replace(/onSuccess:\s*\(\s*data\s*\)\s*=>\s*\{([\s\S]*?)queryClient\.invalidateQueries\(\{\s*queryKey:\s*\["mixing-run",\s*([^\]]+)\]\s*\}\);/g, 'onSuccess: (data, variables) => {$1queryClient.invalidateQueries({ queryKey: ["mixing-run", variables.id || variables.mixingRunId || variables.allocationId || variables.runId || (data as any).mixingRunId || (data as any).id] });');

fs.writeFileSync(mixingPath, mixingCode);

const packagingPath = '/home/abdul-rehman/Projects/titan-new/src/hooks/manufacturing/packaging/use-packaging-mutations.ts';
let packagingCode = fs.readFileSync(packagingPath, 'utf8');

packagingCode = packagingCode.replace(/onSuccess:\s*\(\s*data\s*\)\s*=>\s*\{([\s\S]*?)queryClient\.invalidateQueries\(\{\s*queryKey:\s*\["mixing-run",\s*([^\]]+)\]\s*\}\);/g, 'onSuccess: (data, variables) => {$1queryClient.invalidateQueries({ queryKey: ["mixing-run", (data as any).mixingRunId || (variables as any).mixingRunId] });');

fs.writeFileSync(packagingPath, packagingCode);
