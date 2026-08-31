import re

with open("src/server-functions/sales/customer-discount-rules-fn.ts", "r") as f:
    content = f.read()

# Fix line 116 checkProductId nullability
content = content.replace(
    "eq(customerDiscountRules.recipeId, checkProductId)",
    "checkProductId ? eq(customerDiscountRules.recipeId, checkProductId) : isNull(customerDiscountRules.recipeId)"
)

# Fix line 194 data.productId -> data.recipeId
content = content.replace("if (data.productId) {", "if (data.recipeId) {")
content = content.replace("conditions.push(eq(customerDiscountRules.recipeId, data.productId));", "conditions.push(eq(customerDiscountRules.recipeId, data.recipeId));")

# Fix line 265 data.productId -> data.recipeId
content = content.replace("eq(customerDiscountRules.recipeId, data.productId),", "eq(customerDiscountRules.recipeId, data.recipeId),")

with open("src/server-functions/sales/customer-discount-rules-fn.ts", "w") as f:
    f.write(content)
