import re

# Fix customer-discount-rules-fn.ts line 40
with open("src/server-functions/sales/customer-discount-rules-fn.ts", "r") as f:
    content = f.read()

content = content.replace("eq(customerDiscountRules.recipeId, data.recipeId),", "eq(customerDiscountRules.recipeId, data.productId),", 1)

with open("src/server-functions/sales/customer-discount-rules-fn.ts", "w") as f:
    f.write(content)

