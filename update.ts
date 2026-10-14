import fs from 'fs';

const path = '/home/abdul-rehman/Projects/titan-new/src/server-functions/manufacturing/packaging/log-packaging-progress-fn.ts';
let code = fs.readFileSync(path, 'utf8');

const validationLogic = `
      // Enforce full cartons if applicable
      let remaining = 0;
      if (recipe.containersPerCarton && recipe.containersPerCarton > 0 && recipe.cartonPackagingId) {
        // Wait, how do we know remaining? We need the total target containers vs completed containers.
        const totalTarget = allocation.targetContainers;
        remaining = totalTarget - (allocation.completedContainers || 0);

        const isPartialLastCarton = remaining < recipe.containersPerCarton && data.containersProduced === remaining;
        
        if (data.containersProduced % recipe.containersPerCarton !== 0 && !isPartialLastCarton) {
          throw new Error(
            \`Units must be packed in full cartons. Each carton holds \${recipe.containersPerCarton} units. \` +
            \`You entered \${data.containersProduced} which is not a multiple of \${recipe.containersPerCarton}.\`
          );
        }
      }
`;

const cartonDeductionLogic = `
      // 3. Carton packaging
      if (recipe.containersPerCarton && recipe.containersPerCarton > 0 && recipe.cartonPackagingId) {
        const [cartonPkg] = await tx
          .select()
          .from(packagingMaterials)
          .where(eq(packagingMaterials.id, recipe.cartonPackagingId));

        if (cartonPkg) {
          const cartonsNeeded = Math.floor(data.containersProduced / recipe.containersPerCarton);
          if (cartonsNeeded > 0) {
            materialsToDeduct.push({
              materialId: cartonPkg.id,
              materialName: cartonPkg.name,
              quantity: cartonsNeeded,
              costPerUnit: parseFloat(cartonPkg.costPerUnit?.toString() || "0"),
            });
          }
        }
      }
`;

code = code.replace('// Calculate bulk consumed', validationLogic + '\n      // Calculate bulk consumed');
code = code.replace('let incrementalPkgCost = 0;', cartonDeductionLogic + '\n      let incrementalPkgCost = 0;');

fs.writeFileSync(path, code);
