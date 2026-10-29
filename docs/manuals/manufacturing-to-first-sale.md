# Manufacturing through the first sale

An easy manual for purchasing, stores, production operators and sales staff.

Checked against the application source on 20 October 2026. Use this with the same version of Titan ERP. Examples explain counting only. Use your factory's approved formulas, pack sizes and prices.

## The whole job

**Factory floor → Supplier → Materials received → Product → Mixing formula → Packaging format → Mixing batch → Actual output → Packing → Stock check → Customer → Invoice.**

Different staff may do different steps. Complete your part and give the next person the correct record number and quantities.

## Who does what?

| Person | Job |
| --- | --- |
| Purchasing or stores | Add suppliers, receive materials, check quantities and record purchases. |
| Production manager | Check formulas and pack formats, assign an operator, create and start the batch. |
| Mixing operator | Record actual new output and complete the assigned batch. |
| Packing operator or authorized production staff | Count the finished packing and confirm it on the completed batch. |
| Quality staff | Record actual checks and decide whether goods may be released under factory procedures. |
| Sales and finance | Check customer terms, prices, stock and payment, then create the invoice and verify the result. |

Use your own login. The employee list in HR does not by itself create a production operator login. Ask the administrator to set up an active user with the necessary production access.

## Words used in Titan

| Word | Easy meaning |
| --- | --- |
| Factory Floor | The inventory location used for chemicals, packaging and this production workflow. |
| Product | The product family or name. |
| Mixing Formula | The approved ingredients and quantities for one bulk batch. |
| Packaging Format | The pack size, pack material and carton arrangement for a product. Some screens still call it a recipe. |
| Bulk | Mixed powder or liquid before packing. |
| Mixing Batch | One production batch made from a formula. Keep its batch number. |
| Full carton | A physical carton containing the full configured number of packs. |
| Partial carton | One physical carton containing fewer packs than a full carton. |
| Loose packs | Finished packs outside cartons. |
| Wallet or account | A finance account used to record money received or paid. |

## 1. Set up the factory floor

An authorized manager should do this once. Reuse the existing correct facility.

1. Open **Inventory Management → Factory-Floor**.
2. If **No Factory Floor Configured** appears, click **Add Factory Floor**.
3. Enter the facility name and address details.
4. Confirm the facility type is **Factory Floor**.
5. Click **Add Facility**.
6. Check that the factory floor is active.

**Inventory Management → Warehouses → Add Warehouse** creates a storage warehouse. Use **Factory-Floor → Add Factory Floor** for the first production facility. A storage warehouse is a different facility type.

For this first-sale workflow, use the same active factory floor throughout. If your business has multiple factory floors, ask the administrator to confirm which one the online sales system uses before production and sale.

Finance should also confirm that the real payment accounts needed for purchases and sales exist under **Finance → Accounts**.

## 2. Add the supplier

1. Open **Suppliers**.
2. Search for the supplier first. Avoid creating a second record for the same business.
3. If it is missing, click **Add Supplier**.
4. Enter **Contact Name**, **Business / Shop Name**, **Phone Number** and **Street Address**.
5. Enter the other known details. Email and National ID / CNIC are optional.
6. Click **Add Supplier**.
7. Open the supplier's profile and check that the business and contact details are correct.

Adding a supplier does not receive materials or record a purchase.

## 3. Receive chemicals and record the purchase

Count or weigh the actual delivery and compare it with the supplier invoice before entering it.

1. Open the supplier's profile.
2. Click **Add Chemical** for a chemical you need to register and receive.
3. Enter the exact **Chemical Name** and the supplier's packaging details.
4. Enter **Quantity** in the chemical's selected **Unit**.
5. Enter **Cost Per Unit (PKR)** for that same unit.
6. Check the purchase total.
7. Enter **Invoice / Reference Number** and any useful notes.
8. Check the payment choice as described below.
9. Click **Add Chemical**.
10. Check the supplier's purchase history and **Inventory Management → Factory-Floor → Chemicals**.

Example only: a delivery of five bags, each holding 20 kg, contains **100 kg**. If the selected unit is kg, the quantity is 100. It is not 5.

If 100 kg costs PKR 20,000, the cost per kg is PKR 200. Do not enter the whole invoice amount into **Cost Per Unit**.

The supplier purchase form sends materials to the factory floor selected by the application. Check the receiving factory floor after saving. If the location is wrong or unclear, ask stores or the administrator to resolve it before production.

### Choose the purchase payment correctly

| What actually happened | What to choose |
| --- | --- |
| Nothing has been paid | **Pay Later**. Check that the purchase stays unpaid. |
| The whole purchase has been paid | Select the actual paying account and **Paid Full**. |
| Only part has been paid | Select the actual paying account, choose **Credit / Partial** and enter the real **Amount Paid**. |

Selecting a paying account can set the payment status to paid. Check it before saving. A payment entry can affect the account balance. Record only money actually paid under your finance procedure.

Do not record the same payment again through **Record Payment** if it was already included in the purchase.

## 4. Receive packaging

1. Open the packaging supplier's profile.
2. Click **Add Packaging**.
3. Choose the correct kind:

| Kind on screen | Use |
| --- | --- |
| Packing | The individual pack or container that holds the product |
| Carton | The outer carton material |
| Sticker | A label or sticker |

4. Enter the material name and the required size or capacity details.
5. Enter **Initial Stock** as the number of packaging items received.
6. Check **Cost Per Unit (PKR)**. It is the cost of one packaging item.
7. For Packing materials, enter accurate **Weight / Pack (g)** and **Material Price / Kg (PKR)** where used by your purchasing calculation. These describe the empty packaging material, not the product's fill weight.
8. Enter the supplier invoice reference and correct payment details.
9. Click **Save Material**.
10. Check the purchase and **Factory-Floor → Packaging** or **Stickers**.

Repeat for every required packaging material, including cartons and labels.

### Later deliveries of an existing material

Click **Buy Again** on the existing purchase row in the supplier purchase history. This opens **Restock Material**.

1. Confirm the selected material is the correct existing item.
2. Enter the quantity in the **new delivery**, not the resulting total stock.
3. Replace any old quantity or price carried into the form.
4. Check the supplier, receiving factory floor, cost and payment details.
5. Click **Restock** and verify the new purchase and stock.

Restocking adds stock. A stock adjustment is for a documented stock correction. Do not use an adjustment to record a supplier delivery.

### Paying a supplier later

Finance can open the specific purchase row's three-dot menu and choose **Record Payment**. Check the remaining balance, amount and actual paying account before saving. Verify that the purchase balance and account entry changed once.

## 5. Add the product

An authorized manager should do this. Reuse an existing matching product.

1. Open **Production → Packaging Formats**.
2. Click **Manage products**.
3. Click **Add Product**.
4. Enter **Product Name** and an optional description.
5. Click **Add Product** to save.
6. Return using **Back to packaging formats**.

The product record alone does not create mixed or finished stock.

## 6. Set up the approved mixing formula

1. Open **Production → Mixing Formulas**.
2. Check whether the approved formula already exists.
3. To add one, click **Create Mixing Formula**.
4. Enter **Mixing Formula Name** and choose **Linked Product**.
5. Enter **Target Batch Size** and the correct **Bulk unit**, kg or liters.
6. Add every approved ingredient and its **quantity per batch**. Check each ingredient's unit.
7. Enter the approved **Production instructions** and any notes.
8. Compare the complete form with the approved production sheet.
9. Click **Create Mixing Formula**.

Use the factory's approved formula. This manual does not supply chemical recipes. Do not substitute materials or change quantities to get past a stock shortage.

The target for a new mixing batch comes from this formula's batch size. Check the formula before creating the batch.

## 7. Set up the packaging format

1. Open **Production → Packaging Formats**.
2. Click **New packaging format**.
3. Select the **Product** and its approved **Mixing formula**.
4. Enter the **Pack name** workers recognize.
5. Enter **Content in one pack** and its **Unit**.
6. Choose **Pack material**, the individual pack or container.
7. Choose **Use cartons** or **Loose packs only**.
8. If using cartons, choose **Carton material** and enter **Packs in one full carton**.
9. Open **Optional: labels, caps and stock alert** if needed. Add the extra material quantity and choose whether it is used for **Each pack** or **Each carton**.
10. Click **Review packaging format**.
11. Check the product, formula, fill size, pack material, carton capacity and extras.
12. Click **Save packaging format**.

Example only: a 500 g pack and 20 packs per carton means one full carton contains 10 kg of product. The pack name alone does not set the fill size or selling price.

Use matching units. Grams and kg measure weight. ml and liters measure volume. Do not assume one liter weighs one kg.

Do not add the pack material or carton a second time under extra materials. Extras are for additional materials such as a label or cap.

Formats already used for packing or stock cannot be changed in the same way as an unused format. Ask the manager to create a new format when the pack specification changes.

## 8. Create and start the mixing batch

The production manager does this step.

1. Open **Production → Mixing Batches**.
2. Click **Create Mixing Batch**.
3. Choose the approved formula, the active factory floor and the operator.
4. Read the stock check.
5. If materials are missing, have stores resolve the shortage at that factory floor. Click **Refresh stock** afterward.
6. Click **Create** once the correct stock is available.
7. Note the new batch number. Give it to the assigned operator.
8. Check the formula, **Target Bulk**, operator and factory floor on the batch details.
9. When production is authorized to begin, click **Start Mixing Batch**.
10. Check that the batch is **in progress**.

**Starting the batch deducts the formula's chemical quantities from that factory floor.** Creating the scheduled batch does not deduct them. Stock is checked again when starting.

Do not create and start a second batch because the first response was slow. Reopen the batch and check its status first.

## 9. Operator: record actual mixing output

1. Open **Production Workstation → Batches**.
2. Find the assigned batch number and click **Open batch**.
3. Check the batch number, formula, **Target Bulk** and unit.
4. Confirm the batch is in progress. If it is still scheduled, ask the production manager to start it.
5. Under **Record Mixing Progress**, enter only the **new output not already recorded**.
6. Click **Record Bulk Output** once.
7. Wait for the result. Check that **Actual Yield** increased by the correct amount.
8. Repeat only for additional unrecorded output.

Example only: first record 60 kg, then record a further 40 kg. The total becomes 100 kg. Do not enter 100 for the second entry, because that would try to add another 100 kg.

When mixing is finished:

1. Compare **Actual Yield** with the measured output.
2. If output is below target, enter the true reason in **Reason for completing below target**.
3. Click **Mark Batch as Completed**.
4. Check that the completed batch opens **Record packing**.

Completion requires positive recorded output. The system limits output against the target. Ask the manager to investigate an incorrect record or an unexpected over-yield.

**Mark zero-output batch failed** is for an actual failed batch with no recorded output or progress logs, with a reason. Ask the manager before using it. It is not a correction button for output already entered.

Completing mixing makes bulk available for packing. It does not by itself make saleable finished packs.

## 10. Record quality checks

Quality staff should follow the factory's approved inspection and release procedure.

1. Open **Production → Production QC**.
2. Find and select the batch. The batch details also have a **Quality Control** tab.
3. Click **Create quality report**.
4. Check the batch and product.
5. Enter the certificate details, including **Certified by** and **Report date**.
6. Use the approved product requirements. Enter the actual result of every applicable check and mark whether it passed.
7. Click **Save quality report**.
8. Open the saved report and check the results.

Saving a quality report records the test results. It does not automatically place cartons on hold or release held stock. Follow the factory's release decision separately. If goods must be held, authorized stock staff must also use the carton hold controls and the factory's physical hold procedure.

## 11. Operator: record finished packing

Use this after the goods have actually been packed and the relevant quality checks have been completed under factory procedures.

1. Find the **completed batch** in **Production Workstation → Batches** and click **Open packing**. Managers can also use the batch's **Packing** tab in Mixing Batches.
2. Check the batch number and **Available to pack**.
3. Under **Select a format to add**, choose the exact pack format.
4. Enter the actual **Full cartons**.
5. Enter the actual **Loose packs** outside cartons.
6. If there is a part-filled carton, open **More options → Add a partial carton** and enter **Packs in partial carton**.
7. Add any other formats packed from this same batch.
8. Check the actual **Packing time** if the default time is wrong.
9. Record only actual spill or packing loss under **Record a spill or packing loss**, with a reason.
10. Check **Weight check**, total packs, physical cartons and **Left to pack**.
11. Click **Review packing**.
12. Compare the review with the goods on the floor. Use **Edit counts** if it is wrong.
13. Click **Confirm & add to finished goods** once.
14. Wait for **Packing saved** and check **Recorded packing**.

### Count full, partial and loose separately

Suppose the saved format holds 20 packs per full carton. You physically have:

| Physical output | Entry |
| --- | --- |
| 10 full cartons | Full cartons = 10 |
| 1 carton holding 8 packs | Packs in partial carton = 8 |
| 5 packs outside cartons | Loose packs = 5 |

This is **213 packs in total**, with **11 physical cartons** and **5 loose packs**. Do not count the eight packs in the partial carton again as loose packs.

At 500 g per pack, those 213 packs contain 106.5 kg of product. The batch must have enough available bulk for that amount plus any actual loss.

**Unused bulk stays available for later packing. It is not a packing loss.** A measured-weight difference is an advanced option. Enter it only from an actual measurement, with the required reason.

### What confirmation does

Confirming packing deducts the pack materials, physical cartons and configured extra materials from the batch's factory floor. It also deducts the used bulk, records any loss and adds finished goods there.

If packaging stock is insufficient, have stores record the real receipt or correct location first. Do not change the format or enter a false stock adjustment to force confirmation.

**Draft saved on this device** means the form is stored in that browser. It has not yet added stock. Stock changes after confirmation succeeds.

If the connection fails after confirmation, keep the same draft. Use **Retry confirmation** or **Check result before editing**. These controls check the original submission. Do not re-enter the same output as a new packing record.

The **Existing packing jobs** workstation tab is for jobs already created under the older allocation workflow. Do not record the same physical output there and in the completed batch form. If **Some bulk is reserved** appears, ask the manager to reconcile the existing job before using that bulk.

## 12. Check finished stock before sale

1. Open **Inventory Management → Factory-Floor → Finished Goods**.
2. Find the correct packaging format.
3. Compare the total packs, complete cartons, partial cartons and outside loose packs with the physical goods and the packing receipt.
4. Open the carton details if counts or hold status need checking.
5. Ask authorized staff to resolve any discrepancy before sale.

Full-carton sales need enough complete saleable cartons. A partial carton is not a full carton. Cartons on hold are not saleable.

Online invoices currently deduct stock from the active factory floor, even though the invoice form offers other warehouses. **For the first sale below, choose that factory floor and keep the sale stock there.** If the stock is in storage or there are multiple factory floors, ask the administrator to check the stock source before invoicing.

Moving stock is a separate stores action under **Inventory Management → Warehouses → Transfer Stock**. It does not create a sale or invoice. Do not transfer the goods just because an older procedure says every sale must come from a storage warehouse.

## 13. Prepare the customer and price

Sales staff should have the real customer details, approved price and payment terms before opening an invoice.

### For a general customer

You can select an existing customer on a **New General Invoice**. If the customer is new, click **New Customer** and enter the real details, including the customer name and type.

### For a distributor

1. Open **Sales → Sales People**.
2. Open the **Distributors** tab and search for the distributor.
3. If missing, click **Add Distributor**.
4. Enter the real details. Set the margin, credit limit and hold status only as authorized by sales management.
5. Click **Create Distributor** and reopen the distributor to check it.

Distributor invoices require an existing distributor.

### Check the approved selling rate

An authorized sales manager can open **Sales → Configurations → Recipe Rates**, choose **General / Walk-in** or the relevant **Distributor**, find the format and use **Set Rate** or the pencil. The rate entered there is **per carton**. Save with the check-mark button.

Check the final invoice rate against the approved price list. Margins, distributor agreements, free-carton rules and overrides can affect the final amount. A product's estimated production cost is not its selling price.

## 14. Make the first invoice

1. Open **Sales → New Invoice**.
2. Choose **New General Invoice** or **New Distributor Invoice**.
3. Select the correct existing customer or enter the new general customer's details.
4. In **Dispatch Settings → Source Warehouse**, choose the active factory floor holding the sale stock.
5. Add the correct packaging format to the invoice items.
6. Choose the selling unit carefully. Enter cartons for a carton sale, or packs/units for a pack sale.
7. Enter the actual quantity being sold. Check the available stock shown.
8. Check the pack size, packs per carton, selling rate and line amount.
9. Check all discounts and any distributor free cartons. Free goods also use stock.
10. Enter only the approved invoice expenses and notes.
11. Set payment details using the instructions below.
12. Review the customer, source warehouse, items, quantities, total and payment one more time.
13. Click **Generate Invoice** once.
14. Wait for success. Find the saved invoice number in the invoice list.

Generating the invoice records the sale and deducts the goods. Do not also manually dispatch or adjust the same stock to account for that sale.

### Record the payment correctly

| Payment situation | What to do |
| --- | --- |
| Cash received in full | Use **Paid in Full (Cash)** or a cash payment row. Check the amount and actual receiving cash account. |
| Some cash received | Enter only the received amount in the cash row. The unpaid balance remains outstanding. |
| Nothing received yet | Use **Pay Later**, with no payment rows. Obtain approval for credit terms. |
| Bank transfer, digital account or cheque | Enter the actual method, receiving account, amount and required reference details. Follow finance verification. |

The full-cash shortcut can select the first available cash account. Check that it is the actual account receiving the money.

Non-cash payments can stay pending until finance verifies them. A payment entered as pending is not yet confirmed paid. Do not use instant verification without the required finance authority and payment evidence.

Check **Paid Amount**, pending payments, **Outstanding Amount** and the amount still left for Pay Later. Never record promised cash as received cash.

## 15. Check the first sale and print the invoice

1. Find the invoice under **Sales → New Invoice**. Adjust the date filter if needed.
2. Open **View** and check the invoice number, customer, product format, quantity, price and payment status.
3. Use **Print** and check the printed invoice before handing it over.
4. Recheck **Factory-Floor → Finished Goods**. The sold quantity should have been deducted once.
5. Check the customer's outstanding balance.
6. Finance checks the receiving account and ledger. For pending non-cash payments, use **Finance → Payment Verification** through the authorized finance process.
7. Keep the invoice number and payment reference with the delivery record.

Example only: start with 10 complete saleable cartons. Sell 2 at PKR 1,000 each, with no discounts or expenses. The invoice is PKR 2,000 and 8 cartons remain. If PKR 1,500 cash was actually received, Paid Amount is PKR 1,500 and Outstanding Amount is PKR 500.

Use the invoice to coordinate the physical delivery. Do not create a second invoice for the same goods because you need another printed copy.

## If something goes wrong

| Problem | What to do |
| --- | --- |
| Supplier or material already exists | Open the existing record. Use Restock for a later delivery. |
| No factory floor or operator available | Ask the administrator to check the facility, active user and permissions. |
| Not enough chemicals | Check the required and missing quantities. Have stores resolve the real stock shortage at the correct factory floor. |
| Batch is still scheduled | Ask the production manager to use Start Mixing Batch. |
| Wrong mixing output entered | Stop and give the manager the batch number, wrong entry and actual measured output. |
| No packaging formats available | Ask the manager to check the active format's product and formula link. |
| Packing exceeds available bulk | Check full, partial and loose counts, fill size, units and any reserved jobs. |
| Packing stock is insufficient | Check the physical packaging receipt and factory-floor stock. |
| Packing confirmation result is unclear | Keep the original draft and use its retry/check controls. |
| Goods exist but sale stock is unavailable | Check factory-floor location, the exact format, carton completeness and hold status. |
| Customer credit or payment hold blocks sale | Ask finance or sales management to resolve it. Do not change the customer or hold to bypass the block. |
| Invoice save result is unclear | Search the invoice list and check stock and payment before submitting again. |
| Invoice is wrong | Give the invoice number and correction details to authorized sales or finance staff. |

Deleting an invoice can reverse stock, customer ledger and wallet entries. Do not delete it just to get another printout or hide a payment problem.

## Operator's short checklist

- [ ] Correct assigned batch number and formula checked.
- [ ] Batch started by the manager.
- [ ] Only new measured mixing output recorded.
- [ ] Actual yield checked before completing the batch.
- [ ] Actual packed full cartons, partial carton and loose packs counted separately.
- [ ] Available bulk, packing time and real loss checked.
- [ ] Review checked before confirming.
- [ ] Packing saved receipt checked and batch number handed to stores.

## First-sale checklist

- [ ] Supplier deliveries and purchase payments recorded once.
- [ ] Product, approved formula and packaging format checked.
- [ ] Mixing and packing completed with actual quantities.
- [ ] Quality decision completed under factory procedures.
- [ ] Finished stock and saleable cartons match the floor.
- [ ] Correct factory floor selected for online sale.
- [ ] Correct customer, rate, discounts and quantity checked.
- [ ] Actual received payment entered in the correct account.
- [ ] Invoice saved, checked and printed.
- [ ] Stock, outstanding balance and finance entries checked.

Batch number: ____________________  Invoice number: ____________________

Prepared by: ____________________  Checked by: ____________________

Date: ____________________
