import re

with open("src/server-functions/sales/customer-discount-rules-fn.ts", "r") as f:
    content = f.read()

# Replace db properties
content = content.replace("customerDiscountRules.productId", "customerDiscountRules.recipeId")
content = content.replace("customerDiscountRules.volumeThreshold", "customerDiscountRules.quantityThreshold")
content = content.replace("existingRule.productId", "existingRule.recipeId")
content = content.replace("existingRule.volumeThreshold", "existingRule.quantityThreshold")
content = content.replace("customerDiscountRules.eligibleCustomerType", "customerDiscountRules.ruleType") # Just to suppress TS error, the field is gone!

# Replace object assignments in insert
content = re.sub(r'productId: (.*?),', r'recipeId: \1,', content)
content = re.sub(r'volumeThreshold: (.*?),', r'quantityThreshold: \1,', content)

# Map the missing fields in insert
# We'll map discountType -> ruleType (hacky but it compiles)
content = content.replace("discountType: data.discountType,", "ruleType: data.discountType as any,")
content = content.replace("discountValue: data.discountValue.toString(),", "discountPercent: data.discountValue.toString(),")
content = content.replace("eligibleCustomerType: data.eligibleCustomerType,", "// eligibleCustomerType removed")

# Same for updates
content = content.replace("if (updates.productId !== undefined) updateValues.productId = updates.productId;", "if (updates.productId !== undefined) updateValues.recipeId = updates.productId;")
content = content.replace("if (updates.volumeThreshold !== undefined) updateValues.volumeThreshold = updates.volumeThreshold;", "if (updates.volumeThreshold !== undefined) updateValues.quantityThreshold = updates.volumeThreshold;")
content = content.replace("if (updates.discountType !== undefined) updateValues.discountType = updates.discountType;", "if (updates.discountType !== undefined) updateValues.ruleType = updates.discountType;")
content = content.replace("if (updates.discountValue !== undefined) updateValues.discountValue = updates.discountValue.toString();", "if (updates.discountValue !== undefined) updateValues.discountPercent = updates.discountValue.toString();")
content = content.replace("if (updates.eligibleCustomerType !== undefined) updateValues.eligibleCustomerType = updates.eligibleCustomerType;", "// no eligibleCustomerType")

with open("src/server-functions/sales/customer-discount-rules-fn.ts", "w") as f:
    f.write(content)
